import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ModalModule } from '../modal/modal.module';
import { StorageModule } from '../storage/storage.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DeliveryService } from './delivery.service';
import { DispatcherService } from './dispatcher.service';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [JobsModule, ModalModule, StorageModule, TelegramModule],
  providers: [DispatcherService, RecoveryService, DeliveryService],
  exports: [DispatcherService, RecoveryService, DeliveryService],
})
export class OrchestrationModule {}
