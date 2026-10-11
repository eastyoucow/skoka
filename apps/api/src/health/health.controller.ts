import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { R2StorageService } from '../storage/r2.storage';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly storage: R2StorageService,
  ) {}

  @Get()
  liveness() {
    return { status: 'ok' };
  }

  /** Ready when Postgres is reachable (Compose depends on this). */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }

  /** R2 connectivity probe (does not gate process readiness). */
  @Get('storage')
  async storageProbe() {
    if (!this.storage.isConfigured()) {
      return { status: 'down', r2: { configured: false } };
    }
    try {
      await this.storage.ping();
      return { status: 'up', r2: { configured: true } };
    } catch (err) {
      return {
        status: 'down',
        r2: {
          configured: true,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
