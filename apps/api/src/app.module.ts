import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { JobsModule } from './jobs/jobs.module';
import { ModalModule } from './modal/modal.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { StorageModule } from './storage/storage.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env', '.env.local'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    StorageModule,
    JobsModule,
    ModalModule,
    OrchestrationModule,
    InternalModule,
    TelegramModule,
    HealthModule,
  ],
})
export class AppModule {}
