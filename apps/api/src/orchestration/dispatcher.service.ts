import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildOutputObjectKey } from '../storage/file-validation';
import { JobsRepository } from '../jobs/jobs.repository';
import { ModalInferenceClient } from '../modal/modal.client';

/**
 * In-process poller: claim QUEUED jobs, spawn Modal, persist modal_call_id.
 * Never holds a DB transaction across network I/O.
 */
@Injectable()
export class DispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private ticking = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly modal: ModalInferenceClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('dispatcher.enabled') ?? true;
    if (!enabled) {
      this.logger.warn('Dispatcher disabled (DISPATCHER_ENABLED=false)');
      return;
    }
    const intervalMs = this.config.get<number>('dispatcher.pollIntervalMs') ?? 2000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    // Unref so the timer alone does not keep the process alive in tests.
    this.timer.unref?.();
    this.logger.log(`Dispatcher started (poll=${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for tests. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const maxConcurrent =
        this.config.get<number>('dispatcher.maxConcurrent') ?? 2;
      while (this.inFlight < maxConcurrent) {
        const claimed = await this.dispatchOne();
        if (!claimed) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'dispatcher_tick_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchOne(): Promise<boolean> {
    if (!this.modal.isConfigured()) {
      return false;
    }

    const publicBaseUrl = this.config.get<string>('publicBaseUrl') ?? '';
    if (!publicBaseUrl) {
      // Avoid claiming jobs we cannot callback to.
      return false;
    }

    const leaseMs = this.config.get<number>('jobs.leaseMs') ?? 12 * 60 * 1000;
    const claimed = await this.jobs.claimQueuedJob(leaseMs);
    if (!claimed) {
      return false;
    }

    const { job, attempt } = claimed;
    if (!job.inputKey) {
      await this.jobs.failSubmitAndMaybeRequeue({
        jobId: job.id,
        attemptId: attempt.id,
        error: 'missing input_key on claimed job',
        maxAttempts: this.config.get<number>('jobs.maxAttempts') ?? 3,
        retryBackoffMs: this.config.get<number>('jobs.retryBackoffMs') ?? 15000,
      });
      return true;
    }

    const outputKey = buildOutputObjectKey(job.id, attempt.id);
    this.inFlight += 1;
    try {
      const { callId } = await this.modal.spawn({
        jobId: job.id,
        attemptId: attempt.id,
        inputKey: job.inputKey,
        prompt: job.prompt,
        outputKey,
        callbackUrl: publicBaseUrl,
      });
      await this.jobs.markAttemptSubmitted(attempt.id, callId);
      this.logger.log(
        JSON.stringify({
          msg: 'job_dispatched',
          jobId: job.id,
          attemptId: attempt.id,
          modalCallId: callId,
        }),
      );
      this.logger.log(
        JSON.stringify({
          msg: 'metric',
          metric: 'job_dispatched',
          jobId: job.id,
          attemptId: attempt.id,
          queueWaitMs: job.createdAt
            ? Date.now() - job.createdAt.getTime()
            : undefined,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          msg: 'modal_spawn_failed',
          jobId: job.id,
          attemptId: attempt.id,
          error: message,
        }),
      );
      await this.jobs.failSubmitAndMaybeRequeue({
        jobId: job.id,
        attemptId: attempt.id,
        error: message,
        maxAttempts: this.config.get<number>('jobs.maxAttempts') ?? 3,
        retryBackoffMs: this.config.get<number>('jobs.retryBackoffMs') ?? 15000,
      });
    } finally {
      this.inFlight -= 1;
    }
    return true;
  }
}
