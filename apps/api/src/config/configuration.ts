export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  runMigrations: (process.env.RUN_MIGRATIONS ?? 'true').toLowerCase() !== 'false',
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
  },
  /** Shared with Modal; used in Phase 4 callback auth. Documented here for env parity. */
  callbackSharedSecret: process.env.CALLBACK_SHARED_SECRET ?? '',
});
