import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Delivery } from '../jobs/entities/delivery.entity';
import { JobStatus } from '../jobs/entities/job-status';
import { JobsRepository } from '../jobs/jobs.repository';
import { R2StorageService } from '../storage/r2.storage';
import { TelegramClient } from '../telegram/telegram.client';

/**
 * In-process poller: claim PENDING deliveries, send Telegram result/error,
 * persist message id. Never re-queues Modal/inference on send failure.
 */
@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private ticking = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly storage: R2StorageService,
    private readonly telegram: TelegramClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('delivery.enabled') ?? true;
    if (!enabled) {
      this.logger.warn('Delivery disabled (DELIVERY_ENABLED=false)');
      return;
    }
    const intervalMs = this.config.get<number>('delivery.pollIntervalMs') ?? 2000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`Delivery started (poll=${intervalMs}ms)`);
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
        this.config.get<number>('delivery.maxConcurrent') ?? 4;
      while (this.inFlight < maxConcurrent) {
        const claimed = await this.deliverOne();
        if (!claimed) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'delivery_tick_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      this.ticking = false;
    }
  }

  private async deliverOne(): Promise<boolean> {
    if (!this.telegram.isConfigured()) {
      return false;
    }

    const leaseMs = this.config.get<number>('delivery.leaseMs') ?? 60_000;
    const delivery = await this.jobs.claimPendingDelivery(leaseMs);
    if (!delivery) {
      return false;
    }

    this.inFlight += 1;
    try {
      await this.sendClaimed(delivery);
    } finally {
      this.inFlight -= 1;
    }
    return true;
  }

  private async sendClaimed(delivery: Delivery): Promise<void> {
    const maxAttempts = this.config.get<number>('delivery.maxAttempts') ?? 5;
    const retryBackoffMs =
      this.config.get<number>('delivery.retryBackoffMs') ?? 10_000;

    try {
      const job = await this.jobs.findById(delivery.jobId);
      if (!job) {
        throw new Error(`job missing for delivery ${delivery.id}`);
      }

      if (job.status === JobStatus.COMPLETED) {
        if (!job.outputKey) {
          throw new Error('completed job missing output_key');
        }
        const bytes = await this.storage.getObject(job.outputKey);
        const caption = formatSuccessCaption(
          job.objectCount ?? 0,
          job.prompt,
        );
        const { messageId } = await this.telegram.sendPhoto(
          delivery.recipientId,
          bytes,
          caption,
        );
        await this.jobs.markDeliverySent(delivery.id, messageId);
        this.logger.log(
          JSON.stringify({
            msg: 'metric',
            metric: 'delivery_sent',
            kind: 'success',
            jobId: job.id,
            deliveryId: delivery.id,
            objectCount: job.objectCount,
            queueWaitMs: Date.now() - delivery.createdAt.getTime(),
          }),
        );
        return;
      }

      if (job.status === JobStatus.FAILED) {
        const { messageId } = await this.telegram.sendText(
          delivery.recipientId,
          formatFailureMessage(job.prompt),
        );
        await this.jobs.markDeliverySent(delivery.id, messageId);
        this.logger.log(
          JSON.stringify({
            msg: 'metric',
            metric: 'delivery_sent',
            kind: 'failure_notice',
            jobId: job.id,
            deliveryId: delivery.id,
          }),
        );
        return;
      }

      // Job not terminal yet (should be rare if arming is correct) — retry later.
      await this.jobs.markDeliveryRetryOrFail({
        deliveryId: delivery.id,
        maxAttempts,
        retryBackoffMs,
        error: `job_not_terminal:${job.status}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          msg: 'delivery_send_failed',
          deliveryId: delivery.id,
          jobId: delivery.jobId,
          error: message,
        }),
      );
      const result = await this.jobs.markDeliveryRetryOrFail({
        deliveryId: delivery.id,
        maxAttempts,
        retryBackoffMs,
        error: message,
      });
      this.logger.log(
        JSON.stringify({
          msg: 'metric',
          metric: result.terminal ? 'delivery_failed' : 'delivery_retry',
          deliveryId: delivery.id,
          jobId: delivery.jobId,
          attempts: result.delivery.attempts,
        }),
      );
    }
  }
}

export function formatSuccessCaption(
  objectCount: number,
  prompt: string,
): string {
  const label = prompt.slice(0, 64);
  if (objectCount === 0) {
    return `Found 0 “${label}”.`;
  }
  return `Found ${objectCount} “${label}”.`;
}

/** Sanitized user-facing text — no stacks, keys, or internal codes. */
export function formatFailureMessage(prompt: string): string {
  const label = prompt.slice(0, 64);
  return `Sorry — I could not finish counting “${label}”. Please try again with another photo.`;
}
