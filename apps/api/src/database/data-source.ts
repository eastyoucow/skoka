import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { Delivery } from '../jobs/entities/delivery.entity';
import { JobAttempt } from '../jobs/entities/job-attempt.entity';
import { Job } from '../jobs/entities/job.entity';

/**
 * CLI DataSource for TypeORM migrations.
 * Usage (from apps/api):
 *   npm run migration:run
 *   npm run migration:revert
 *   npm run migration:show
 *   npm run migration:generate -- src/migrations/Name
 */
function buildCliDataSource(): DataSource {
  const url = process.env.DATABASE_URL;
  const ssl = (process.env.DATABASE_SSL ?? 'false').toLowerCase() === 'true';

  const common = {
    type: 'postgres' as const,
    entities: [Job, JobAttempt, Delivery],
    migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: true,
    extra: {
      max: parseInt(process.env.DATABASE_POOL_MAX ?? '5', 10),
    },
  };

  const sslOption = ssl ? { rejectUnauthorized: false } : false;

  if (url) {
    return new DataSource({
      ...common,
      url,
      ssl: sslOption,
    });
  }

  return new DataSource({
    ...common,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    username: process.env.DATABASE_USER ?? 'skoka',
    password: process.env.DATABASE_PASSWORD ?? 'skoka',
    database: process.env.DATABASE_NAME ?? 'skoka',
    ssl: sslOption,
  });
}

export default buildCliDataSource();
