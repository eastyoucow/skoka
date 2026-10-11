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
   * Claim a queued job for processing (Phase 4 dispatcher will use this).
   * Short transaction with SKIP LOCKED — no network I/O inside.
   */
  async claimQueuedJob(leaseMs: number): Promise<{
    job: Job;
    attempt: JobAttempt;
  } | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Job[] = await manager.query(
        `
        SELECT * FROM jobs
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
