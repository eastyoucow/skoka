import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { CallbackAuthGuard } from './callback-auth.guard';
import { InternalJobsController } from './internal-jobs.controller';

@Module({
  imports: [JobsModule],
  controllers: [InternalJobsController],
  providers: [CallbackAuthGuard],
})
export class InternalModule {}
