import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsRepository } from '../jobs/jobs.repository';

/**
 * Reconciles expired PROCESSING leases and stale RECEIVED jobs.
 * Does not re-check Modal execution status in V1 (known duplicate-GPU risk).
 */
@Injectable()
export class RecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('recovery.enabled') ?? true;
    if (!enabled) {
      this.logger.warn('Recovery disabled (RECOVERY_ENABLED=false)');
      return;
    }
    const intervalMs = this.config.get<number>('recovery.pollIntervalMs') ?? 10000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`Recovery started (poll=${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const maxAttempts = this.config.get<number>('jobs.maxAttempts') ?? 3;
      const retryBackoffMs =
        this.config.get<number>('jobs.retryBackoffMs') ?? 15000;

      const recovered = await this.jobs.recoverExpiredLeases({
        maxAttempts,
        retryBackoffMs,
      });
      const stale = await this.jobs.failStaleReceived();
      const deliveryLeases = await this.jobs.recoverExpiredDeliveryLeases();

      if (recovered > 0 || stale > 0 || deliveryLeases > 0) {
        this.logger.log(
          JSON.stringify({
            msg: 'recovery_tick',
            expiredLeasesHandled: recovered,
            staleReceivedFailed: stale,
            expiredDeliveryLeasesHandled: deliveryLeases,
          }),
        );
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'recovery_tick_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      this.ticking = false;
    }
  }
}
