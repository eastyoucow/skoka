import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('MigrationRunner');

/**
 * Explicit migration runner used by Docker entrypoint / CLI.
 * Nest also sets `migrationsRun` so the app auto-migrates on boot when enabled.
 */
export async function runPendingMigrations(dataSource: DataSource): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const pending = await dataSource.showMigrations();
  if (!pending) {
    logger.log('No pending migrations');
    return;
  }

  logger.log('Running pending migrations…');
  const executed = await dataSource.runMigrations({ transaction: 'each' });
  for (const migration of executed) {
    logger.log(`Applied migration: ${migration.name}`);
  }
}
