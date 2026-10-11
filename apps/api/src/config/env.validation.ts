function requireInProduction(name: string, value: string | undefined): void {
  if ((process.env.NODE_ENV ?? 'development') === 'production' && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  // Soft validation: production requires DB + R2; local Compose supplies defaults.
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    requireInProduction('DATABASE_URL', process.env.DATABASE_URL);
    requireInProduction('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID);
    requireInProduction('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY);
    requireInProduction('R2_BUCKET', process.env.R2_BUCKET);
  }
  return config;
}
