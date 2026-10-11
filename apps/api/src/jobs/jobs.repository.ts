import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Delivery } from './entities/delivery.entity';
import { JobAttempt } from './entities/job-attempt.entity';
import { Job } from './entities/job.entity';
import {
  AttemptStatus,
  DeliveryChannel,
  DeliveryStatus,
  JobSource,
  JobStatus,
  assertJobTransition,
} from './entities/job-status';

export interface CreateJobParams {
  source: JobSource;
  externalRequestId: string;
  prompt: string;
  channel: DeliveryChannel;
  recipientId: string;
  deadlineAt: Date;
}

@Injectable()
export class JobsRepository {
  constructor(
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(JobAttempt) private readonly attempts: Repository<JobAttempt>,
    @InjectRepository(Delivery) private readonly deliveries: Repository<Delivery>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<Job | null> {
    return this.jobs.findOne({ where: { id } });
  }

  findBySourceExternal(
    source: JobSource,
    externalRequestId: string,
  ): Promise<Job | null> {
    return this.jobs.findOne({ where: { source, externalRequestId } });
  }

  findAttemptById(id: string): Promise<JobAttempt | null> {
    return this.attempts.findOne({ where: { id } });
  }

  /**
   * Idempotent create: unique (source, external_request_id).
   * Returns existing job when the pair already exists.
   */
  async createReceivedJob(
    params: CreateJobParams,
  ): Promise<{ job: Job; created: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Job, {
        where: {
          source: params.source,
          externalRequestId: params.externalRequestId,
        },
      });
      if (existing) {
        return { job: existing, created: false };
      }

      const job = manager.create(Job, {
        source: params.source,
        externalRequestId: params.externalRequestId,
        prompt: params.prompt,
        status: JobStatus.RECEIVED,
        deadlineAt: params.deadlineAt,
      });
      const saved = await manager.save(job);

      const delivery = manager.create(Delivery, {
        jobId: saved.id,
        channel: params.channel,
        recipientId: params.recipientId,
        status: DeliveryStatus.PENDING,
        attempts: 0,
      });
      await manager.save(delivery);

      return { job: saved, created: true };
    });
  }

  /**
   * Persist input object key and transition RECEIVED -> QUEUED in one transaction.
   */
  async markQueuedWithInput(jobId: string, inputKey: string): Promise<Job> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(Job, {
        where: { id: jobId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      if (job.status === JobStatus.QUEUED && job.inputKey === inputKey) {
        return job;
      }

      assertJobTransition(job.status, JobStatus.QUEUED);
      job.inputKey = inputKey;
      job.status = JobStatus.QUEUED;
      job.nextAttemptAt = new Date();
      return manager.save(job);
    });
  }

  /**
   * Claim a queued job for processing.
   * Short transaction with SKIP LOCKED — no network I/O inside.
   */
  async claimQueuedJob(leaseMs: number): Promise<{
    job: Job;
    attempt: JobAttempt;
  } | null> {
    return this.claimQueuedJobInternal(leaseMs);
  }

  /**
   * Claim a specific queued job (tests / targeted recovery).
   * Returns null if the job is not currently claimable.
   */
  async claimQueuedJobById(
    jobId: string,
    leaseMs: number,
  ): Promise<{ job: Job; attempt: JobAttempt } | null> {
    return this.claimQueuedJobInternal(leaseMs, jobId);
  }

  private async claimQueuedJobInternal(
    leaseMs: number,
    jobId?: string,
  ): Promise<{ job: Job; attempt: JobAttempt } | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = jobId
        ? await manager.query(
            `
            SELECT id FROM jobs
            WHERE id = $1
              AND status = $2
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
              AND (lease_until IS NULL OR lease_until < NOW())
              AND (deadline_at IS NULL OR deadline_at > NOW())
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            `,
            [jobId, JobStatus.QUEUED],
          )
        : await manager.query(
            `
            SELECT id FROM jobs
            WHERE status = $1
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
              AND (lease_until IS NULL OR lease_until < NOW())
              AND (deadline_at IS NULL OR deadline_at > NOW())
            ORDER BY next_attempt_at NULLS FIRST, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            `,
            [JobStatus.QUEUED],
          );

      if (!rows.length) {
        return null;
      }

      const job = await manager.findOneOrFail(Job, { where: { id: rows[0].id } });
      assertJobTransition(job.status, JobStatus.PROCESSING);

      const attemptNumber = await this.nextAttemptNumber(manager, job.id);
      const attempt = await manager.save(
        manager.create(JobAttempt, {
          jobId: job.id,
          attemptNumber,
          status: AttemptStatus.PENDING,
          startedAt: new Date(),
        }),
      );

      job.status = JobStatus.PROCESSING;
      job.activeAttemptId = attempt.id;
      job.leaseUntil = new Date(Date.now() + leaseMs);
      await manager.save(job);

      return { job, attempt };
    });
  }

  /** Persist Modal call id after spawn (outside the claim transaction). */
  async markAttemptSubmitted(
    attemptId: string,
    modalCallId: string,
  ): Promise<JobAttempt> {
    return this.dataSource.transaction(async (manager) => {
      const attempt = await manager.findOne(JobAttempt, {
        where: { id: attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt) {
        throw new Error(`Attempt not found: ${attemptId}`);
      }
      // Callback may have already finished this attempt.
      if (
        attempt.status === AttemptStatus.SUCCEEDED ||
        attempt.status === AttemptStatus.FAILED
      ) {
        if (!attempt.modalCallId) {
          attempt.modalCallId = modalCallId;
          return manager.save(attempt);
        }
        return attempt;
      }
      attempt.modalCallId = modalCallId;
      attempt.status = AttemptStatus.SUBMITTED;
      return manager.save(attempt);
    });
  }

  /**
   * Accept a completion callback only for the active attempt.
   * Activates delivery (next_retry_at = now) in the same transaction.
   * Returns whether this call applied new side effects.
   */
  async acceptCompletion(params: {
    jobId: string;
    attemptId: string;
    count: number;
    outputKey: string;
  }): Promise<{ applied: boolean; job: Job }> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(Job, {
        where: { id: params.jobId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        throw new Error(`Job not found: ${params.jobId}`);
      }

      // Duplicate / late callback: success without side effects.
      if (job.status === JobStatus.COMPLETED) {
        return { applied: false, job };
      }

      if (
        job.activeAttemptId !== params.attemptId ||
        job.status !== JobStatus.PROCESSING
      ) {
        return { applied: false, job };
      }

      assertJobTransition(job.status, JobStatus.COMPLETED);

      const attempt = await manager.findOne(JobAttempt, {
        where: { id: params.attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt || attempt.jobId !== job.id) {
        return { applied: false, job };
      }

      attempt.status = AttemptStatus.SUCCEEDED;
      attempt.finishedAt = new Date();
      attempt.error = null;
      await manager.save(attempt);

      job.status = JobStatus.COMPLETED;
      job.objectCount = params.count;
      job.outputKey = params.outputKey;
      job.leaseUntil = null;
      job.nextAttemptAt = null;
      await manager.save(job);

      await manager
        .createQueryBuilder()
        .update(Delivery)
        .set({ nextRetryAt: new Date() })
        .where('job_id = :jobId', { jobId: job.id })
        .andWhere('status = :status', { status: DeliveryStatus.PENDING })
        .execute();

      return { applied: true, job };
    });
  }

  /**
   * Accept a failure callback for the active attempt.
   * Re-queues when attempts remain and deadline allows; otherwise terminal FAILED.
   */
  async acceptFailure(params: {
    jobId: string;
    attemptId: string;
    code: string;
    message: string;
    maxAttempts: number;
    retryBackoffMs: number;
  }): Promise<{ applied: boolean; job: Job; terminal: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(Job, {
        where: { id: params.jobId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        throw new Error(`Job not found: ${params.jobId}`);
      }

      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED
      ) {
        return { applied: false, job, terminal: job.status === JobStatus.FAILED };
      }

      if (job.activeAttemptId !== params.attemptId) {
        return { applied: false, job, terminal: false };
      }

      if (job.status !== JobStatus.PROCESSING) {
        return { applied: false, job, terminal: false };
      }

      const attempt = await manager.findOne(JobAttempt, {
        where: { id: params.attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt || attempt.jobId !== job.id) {
        return { applied: false, job, terminal: false };
      }

      const errText = `${params.code}: ${params.message}`.slice(0, 1000);
      attempt.status = AttemptStatus.FAILED;
      attempt.error = errText;
      attempt.finishedAt = new Date();
      await manager.save(attempt);

      const attemptCount = attempt.attemptNumber;
      const pastDeadline =
        job.deadlineAt !== null && job.deadlineAt.getTime() <= Date.now();
      const canRetry = attemptCount < params.maxAttempts && !pastDeadline;

      if (canRetry) {
        assertJobTransition(job.status, JobStatus.QUEUED);
        job.status = JobStatus.QUEUED;
        job.activeAttemptId = null;
        job.leaseUntil = null;
        job.nextAttemptAt = new Date(Date.now() + params.retryBackoffMs * attemptCount);
        await manager.save(job);
        return { applied: true, job, terminal: false };
      }

      assertJobTransition(job.status, JobStatus.FAILED);
      job.status = JobStatus.FAILED;
      job.leaseUntil = null;
      job.nextAttemptAt = null;
      await manager.save(job);

      // Terminal failure: mark deliveries ready so Phase 5 can notify once.
      await manager
        .createQueryBuilder()
        .update(Delivery)
        .set({ nextRetryAt: new Date() })
        .where('job_id = :jobId', { jobId: job.id })
        .andWhere('status = :status', { status: DeliveryStatus.PENDING })
        .execute();

      return { applied: true, job, terminal: true };
    });
  }

  /**
   * After Modal spawn failure (before durable callback): fail the attempt and
   * re-queue or terminal-fail the job.
   */
  async failSubmitAndMaybeRequeue(params: {
    jobId: string;
    attemptId: string;
    error: string;
    maxAttempts: number;
    retryBackoffMs: number;
  }): Promise<{ job: Job; terminal: boolean }> {
    return this.acceptFailure({
      jobId: params.jobId,
      attemptId: params.attemptId,
      code: 'SUBMIT_FAILED',
      message: params.error,
      maxAttempts: params.maxAttempts,
      retryBackoffMs: params.retryBackoffMs,
    }).then((r) => ({ job: r.job, terminal: r.terminal }));
  }

  /**
   * Recover jobs stuck in PROCESSING with expired leases.
   * Returns number of jobs re-queued or failed.
   */
  async recoverExpiredLeases(params: {
    maxAttempts: number;
    retryBackoffMs: number;
  }): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `
        SELECT id FROM jobs
        WHERE status = $1
          AND lease_until IS NOT NULL
          AND lease_until < NOW()
        ORDER BY lease_until ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 20
        `,
        [JobStatus.PROCESSING],
      );

      let handled = 0;
      for (const row of rows) {
        const job = await manager.findOneOrFail(Job, { where: { id: row.id } });
        if (job.status !== JobStatus.PROCESSING) {
          continue;
        }

        const attemptId = job.activeAttemptId;
        let attemptNumber = 0;
        if (attemptId) {
          const attempt = await manager.findOne(JobAttempt, {
            where: { id: attemptId },
            lock: { mode: 'pessimistic_write' },
          });
          if (attempt && attempt.status !== AttemptStatus.SUCCEEDED) {
            attemptNumber = attempt.attemptNumber;
            if (
              attempt.status === AttemptStatus.PENDING ||
              attempt.status === AttemptStatus.SUBMITTED
            ) {
              attempt.status = AttemptStatus.FAILED;
              attempt.error = 'LEASE_EXPIRED: no callback before lease ended';
              attempt.finishedAt = new Date();
              await manager.save(attempt);
            }
          }
        }

        const pastDeadline =
          job.deadlineAt !== null && job.deadlineAt.getTime() <= Date.now();
        const canRetry = attemptNumber < params.maxAttempts && !pastDeadline;

        if (canRetry) {
          assertJobTransition(job.status, JobStatus.QUEUED);
          job.status = JobStatus.QUEUED;
          job.activeAttemptId = null;
          job.leaseUntil = null;
          job.nextAttemptAt = new Date(
            Date.now() + params.retryBackoffMs * Math.max(1, attemptNumber),
          );
        } else {
          assertJobTransition(job.status, JobStatus.FAILED);
          job.status = JobStatus.FAILED;
          job.leaseUntil = null;
          job.nextAttemptAt = null;
          await manager
            .createQueryBuilder()
            .update(Delivery)
            .set({ nextRetryAt: new Date() })
            .where('job_id = :jobId', { jobId: job.id })
            .andWhere('status = :status', { status: DeliveryStatus.PENDING })
            .execute();
        }
        await manager.save(job);
        handled += 1;
      }
      return handled;
    });
  }

  /**
   * Fail RECEIVED jobs that never got input before deadline.
   * Arms PENDING deliveries so the delivery loop can notify once.
   */
  async failStaleReceived(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `
        SELECT id FROM jobs
        WHERE status = $1
          AND deadline_at IS NOT NULL
          AND deadline_at < NOW()
        ORDER BY deadline_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 50
        `,
        [JobStatus.RECEIVED],
      );

      let handled = 0;
      for (const row of rows) {
        const job = await manager.findOneOrFail(Job, { where: { id: row.id } });
        if (job.status !== JobStatus.RECEIVED) {
          continue;
        }
        assertJobTransition(job.status, JobStatus.FAILED);
        job.status = JobStatus.FAILED;
        await manager.save(job);
        await manager
          .createQueryBuilder()
          .update(Delivery)
          .set({ nextRetryAt: new Date() })
          .where('job_id = :jobId', { jobId: job.id })
          .andWhere('status = :status', { status: DeliveryStatus.PENDING })
          .execute();
        handled += 1;
      }
      return handled;
    });
  }

  /**
   * Claim a PENDING delivery ready for send.
   * Short transaction with SKIP LOCKED — no network I/O inside.
   */
  async claimPendingDelivery(leaseMs: number): Promise<Delivery | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `
        SELECT id FROM deliveries
        WHERE status = $1
          AND next_retry_at IS NOT NULL
          AND next_retry_at <= NOW()
          AND (lease_until IS NULL OR lease_until < NOW())
        ORDER BY next_retry_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        `,
        [DeliveryStatus.PENDING],
      );

      if (!rows.length) {
        return null;
      }

      const delivery = await manager.findOneOrFail(Delivery, {
        where: { id: rows[0].id },
      });
      delivery.status = DeliveryStatus.SENDING;
      delivery.attempts += 1;
      delivery.leaseUntil = new Date(Date.now() + leaseMs);
      delivery.nextRetryAt = null;
      return manager.save(delivery);
    });
  }

  async markDeliverySent(
    deliveryId: string,
    externalMessageId: string,
  ): Promise<Delivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await manager.findOne(Delivery, {
        where: { id: deliveryId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!delivery) {
        throw new Error(`Delivery not found: ${deliveryId}`);
      }
      if (delivery.status === DeliveryStatus.SENT) {
        return delivery;
      }
      delivery.status = DeliveryStatus.SENT;
      delivery.externalMessageId = externalMessageId;
      delivery.leaseUntil = null;
      delivery.nextRetryAt = null;
      return manager.save(delivery);
    });
  }

  /**
   * After a send failure: backoff to PENDING or terminal FAILED.
   * Never touches job / inference state.
   */
  async markDeliveryRetryOrFail(params: {
    deliveryId: string;
    maxAttempts: number;
    retryBackoffMs: number;
    error?: string;
  }): Promise<{ delivery: Delivery; terminal: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await manager.findOne(Delivery, {
        where: { id: params.deliveryId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!delivery) {
        throw new Error(`Delivery not found: ${params.deliveryId}`);
      }
      if (
        delivery.status === DeliveryStatus.SENT ||
        delivery.status === DeliveryStatus.FAILED
      ) {
        return {
          delivery,
          terminal: delivery.status === DeliveryStatus.FAILED,
        };
      }

      const canRetry = delivery.attempts < params.maxAttempts;
      if (canRetry) {
        delivery.status = DeliveryStatus.PENDING;
        delivery.leaseUntil = null;
        delivery.nextRetryAt = new Date(
          Date.now() +
            params.retryBackoffMs * Math.max(1, delivery.attempts),
        );
        await manager.save(delivery);
        return { delivery, terminal: false };
      }

      delivery.status = DeliveryStatus.FAILED;
      delivery.leaseUntil = null;
      delivery.nextRetryAt = null;
      await manager.save(delivery);
      return { delivery, terminal: true };
    });
  }

  /**
   * Recover deliveries stuck in SENDING with expired leases
   * (crash mid-send). Returns them to PENDING for retry.
   */
  async recoverExpiredDeliveryLeases(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `
        SELECT id FROM deliveries
        WHERE status = $1
          AND lease_until IS NOT NULL
          AND lease_until < NOW()
        ORDER BY lease_until ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 20
        `,
        [DeliveryStatus.SENDING],
      );

      let handled = 0;
      for (const row of rows) {
        const delivery = await manager.findOneOrFail(Delivery, {
          where: { id: row.id },
        });
        if (delivery.status !== DeliveryStatus.SENDING) {
          continue;
        }
        delivery.status = DeliveryStatus.PENDING;
        delivery.leaseUntil = null;
        delivery.nextRetryAt = new Date();
        await manager.save(delivery);
        handled += 1;
      }
      return handled;
    });
  }

  findDeliveryByJobId(jobId: string): Promise<Delivery | null> {
    return this.deliveries.findOne({ where: { jobId } });
  }

  private async nextAttemptNumber(
    manager: EntityManager,
    jobId: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(JobAttempt, 'a')
      .select('COALESCE(MAX(a.attempt_number), 0)', 'max')
      .where('a.job_id = :jobId', { jobId })
      .getRawOne<{ max: string }>();
    return Number(result?.max ?? 0) + 1;
  }
}
