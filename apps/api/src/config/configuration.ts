export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  runMigrations: (process.env.RUN_MIGRATIONS ?? 'true').toLowerCase() !== 'false',
  /** Public API origin for Modal callbacks (no path), e.g. https://api.example.com */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    username: process.env.DATABASE_USER ?? 'skoka',
    password: process.env.DATABASE_PASSWORD ?? 'skoka',
    name: process.env.DATABASE_NAME ?? 'skoka',
    ssl: (process.env.DATABASE_SSL ?? 'false').toLowerCase() === 'true',
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '5', 10),
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    endpoint: process.env.R2_ENDPOINT ?? '',
  },
  uploads: {
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES ?? String(10 * 1024 * 1024), 10),
    allowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  jobs: {
    /** Max age for processing before deadline; must stay below R2 ~24h lifecycle. */
    deadlineHours: parseInt(process.env.JOB_DEADLINE_HOURS ?? '12', 10),
    maxAttempts: parseInt(process.env.JOB_MAX_ATTEMPTS ?? '3', 10),
    /** Lease held while Modal runs; Modal function timeout is 600s. */
    leaseMs: parseInt(process.env.JOB_LEASE_MS ?? String(12 * 60 * 1000), 10),
    /** Base backoff when re-queuing after lease expiry / submit failure. */
    retryBackoffMs: parseInt(process.env.JOB_RETRY_BACKOFF_MS ?? '15000', 10),
  },
  dispatcher: {
    enabled: (process.env.DISPATCHER_ENABLED ?? 'true').toLowerCase() !== 'false',
    pollIntervalMs: parseInt(process.env.DISPATCHER_POLL_MS ?? '2000', 10),
    /** Max in-flight Modal submits from this process (matches Modal max_containers). */
    maxConcurrent: parseInt(process.env.DISPATCHER_MAX_CONCURRENT ?? '2', 10),
  },
  recovery: {
    enabled: (process.env.RECOVERY_ENABLED ?? 'true').toLowerCase() !== 'false',
    pollIntervalMs: parseInt(process.env.RECOVERY_POLL_MS ?? '10000', 10),
  },
  delivery: {
    enabled: (process.env.DELIVERY_ENABLED ?? 'true').toLowerCase() !== 'false',
    pollIntervalMs: parseInt(process.env.DELIVERY_POLL_MS ?? '2000', 10),
    maxConcurrent: parseInt(process.env.DELIVERY_MAX_CONCURRENT ?? '4', 10),
    /** Lease while Telegram send is in flight. */
    leaseMs: parseInt(process.env.DELIVERY_LEASE_MS ?? '60000', 10),
    maxAttempts: parseInt(process.env.DELIVERY_MAX_ATTEMPTS ?? '5', 10),
    retryBackoffMs: parseInt(process.env.DELIVERY_RETRY_BACKOFF_MS ?? '10000', 10),
  },
  /** Soft per-IP rate limit for Telegram webhook (in-memory; single instance). */
  rateLimit: {
    telegramWebhookPerMinute: parseInt(
      process.env.RATE_LIMIT_TELEGRAM_PER_MINUTE ?? '60',
      10,
    ),
  },
  /** Shared with Modal secret skoka-dev — Bearer + HMAC callback auth. */
  callbackSharedSecret: process.env.CALLBACK_SHARED_SECRET ?? '',
  callbackMaxSkewSeconds: parseInt(process.env.CALLBACK_MAX_SKEW_SECONDS ?? '300', 10),
  modal: {
    appName: process.env.MODAL_APP_NAME ?? 'skoka-inference',
    functionName: process.env.MODAL_FUNCTION_NAME ?? 'run_job',
    tokenId: process.env.MODAL_TOKEN_ID ?? '',
    tokenSecret: process.env.MODAL_TOKEN_SECRET ?? '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    /** Must match secret_token set on setWebhook. */
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    /** Default SAM3 prompt when photo has no caption (V1). */
    defaultPrompt: process.env.TELEGRAM_DEFAULT_PROMPT ?? 'person',
  },
});
