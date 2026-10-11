function requireInProduction(name: string, value: string | undefined): void {
  if ((process.env.NODE_ENV ?? 'development') === 'production' && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  // Soft validation: production requires DB + R2 + callback + Telegram + public URL + Modal.
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    requireInProduction('DATABASE_URL', process.env.DATABASE_URL);
    requireInProduction('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID);
    requireInProduction('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY);
    requireInProduction('R2_BUCKET', process.env.R2_BUCKET);
    requireInProduction('CALLBACK_SHARED_SECRET', process.env.CALLBACK_SHARED_SECRET);
    requireInProduction('PUBLIC_BASE_URL', process.env.PUBLIC_BASE_URL);
    requireInProduction('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN);
    requireInProduction('TELEGRAM_WEBHOOK_SECRET', process.env.TELEGRAM_WEBHOOK_SECRET);
    requireInProduction('MODAL_TOKEN_ID', process.env.MODAL_TOKEN_ID);
    requireInProduction('MODAL_TOKEN_SECRET', process.env.MODAL_TOKEN_SECRET);
  }
  return config;
}
