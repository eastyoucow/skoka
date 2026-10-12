import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { WebJobRequest } from './entities/web-job-request.entity';
import { WebSession } from './entities/web-session.entity';
import { WebUpload } from './entities/web-upload.entity';
import { WebAuthGuard } from './web-auth.guard';
import { WebController } from './web.controller';
import {
  WebJobsRateLimitGuard,
  WebSessionsRateLimitGuard,
  WebUploadsRateLimitGuard,
} from './web-rate-limits';
import { WebSessionService } from './web-session.service';
import { WebService } from './web.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebSession, WebUpload, WebJobRequest]),
    JobsModule,
    StorageModule,
  ],
  controllers: [WebController],
  providers: [
    WebSessionService,
    WebService,
    WebAuthGuard,
    WebSessionsRateLimitGuard,
    WebUploadsRateLimitGuard,
    WebJobsRateLimitGuard,
  ],
  exports: [WebSessionService, WebService],
})
export class WebModule {}
