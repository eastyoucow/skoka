import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

/**
 * Dev/ops multipart job API. Disabled in production — use /web/* with sessions.
 */
@Controller('api/jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  private assertDevOnly(): void {
    const env = this.config.get<string>('nodeEnv') ?? 'development';
    if (env === 'production') {
      throw new ForbiddenException(
        'Use /web/* endpoints for public job access',
      );
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async create(
    @Body() dto: CreateJobDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertDevOnly();
    const { job, created } = await this.jobsService.createWithUpload(dto, file);
    return {
      id: job.id,
      source: job.source,
      externalRequestId: job.externalRequestId,
      prompt: job.prompt,
      status: job.status,
      inputKey: job.inputKey,
      outputKey: job.outputKey,
      objectCount: job.objectCount,
      activeAttemptId: job.activeAttemptId,
      deadlineAt: job.deadlineAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      created,
    };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    this.assertDevOnly();
    const job = await this.jobsService.getById(id);
    return {
      id: job.id,
      source: job.source,
      externalRequestId: job.externalRequestId,
      prompt: job.prompt,
      status: job.status,
      inputKey: job.inputKey,
      outputKey: job.outputKey,
      objectCount: job.objectCount,
      activeAttemptId: job.activeAttemptId,
      deadlineAt: job.deadlineAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
