import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Factory for single-instance sliding-window IP rate limiters.
 * Enough for V1 on one always-on Render instance; not shared across replicas.
 */
export function IpRateLimitGuard(
  configKey: string,
  defaultLimit: number,
): Type<CanActivate> {
  @Injectable()
  class IpRateLimitGuardMixin implements CanActivate {
    private readonly hits = new Map<string, number[]>();

    constructor(private readonly config: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
      const limit = this.config.get<number>(configKey) ?? defaultLimit;
      if (limit <= 0) {
        return true;
      }

      const req = context.switchToHttp().getRequest<Request>();
      const key = clientIp(req);
      const now = Date.now();
      const windowMs = 60_000;
      const timestamps = (this.hits.get(key) ?? []).filter(
        (t) => now - t < windowMs,
      );
      if (timestamps.length >= limit) {
        this.hits.set(key, timestamps);
        throw new HttpException(
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      timestamps.push(now);
      this.hits.set(key, timestamps);

      if (this.hits.size > 10_000) {
        for (const [k, ts] of this.hits) {
          const kept = ts.filter((t) => now - t < windowMs);
          if (!kept.length) {
            this.hits.delete(k);
          } else {
            this.hits.set(k, kept);
          }
        }
      }
      return true;
    }
  }

  return mixin(IpRateLimitGuardMixin);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}
