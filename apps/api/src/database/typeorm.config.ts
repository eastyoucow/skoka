import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import { Delivery } from '../jobs/entities/delivery.entity';
import { JobAttempt } from '../jobs/entities/job-attempt.entity';
import { Job } from '../jobs/entities/job.entity';

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  const url = config.get<string>('database.url');
  const ssl = config.get<boolean>('database.ssl') ?? false;
  const poolMax = config.get<number>('database.poolMax') ?? 5;
  const runMigrations = config.get<boolean>('runMigrations') ?? true;

  const base = {
    type: 'postgres' as const,
    entities: [Job, JobAttempt, Delivery],
    migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: runMigrations,
    logging: (config.get<string>('nodeEnv') ?? 'development') === 'development',
    extra: {
      max: poolMax,
    },
  };

  // Encrypt with TLS; do not require a private CA bundle (Supabase / many managed PG hosts).
  const sslOption = ssl ? { rejectUnauthorized: false } : false;

  if (url) {
    return {
      ...base,
      url,
      ssl: sslOption,
    };
  }

  return {
    ...base,
    host: config.get<string>('database.host'),
    port: config.get<number>('database.port'),
    username: config.get<string>('database.username'),
    password: config.get<string>('database.password'),
    database: config.get<string>('database.name'),
    ssl: sslOption,
  };
}
