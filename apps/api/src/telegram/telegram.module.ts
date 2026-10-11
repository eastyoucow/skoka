import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { TelegramClient } from './telegram.client';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [JobsModule],
  controllers: [TelegramController],
  providers: [TelegramClient, TelegramService],
})
export class TelegramModule {}
