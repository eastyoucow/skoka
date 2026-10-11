import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ModalModule } from '../modal/modal.module';
import { DispatcherService } from './dispatcher.service';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [JobsModule, ModalModule],
  providers: [DispatcherService, RecoveryService],
  exports: [DispatcherService, RecoveryService],
})
export class OrchestrationModule {}
