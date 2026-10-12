import { IpRateLimitGuard } from '../common/ip-rate-limit.guard';

export const WebSessionsRateLimitGuard = IpRateLimitGuard(
  'rateLimit.webSessionsPerMinute',
  30,
);

export const WebUploadsRateLimitGuard = IpRateLimitGuard(
  'rateLimit.webUploadsPerMinute',
  30,
);

export const WebJobsRateLimitGuard = IpRateLimitGuard(
  'rateLimit.webJobsPerMinute',
  20,
);
