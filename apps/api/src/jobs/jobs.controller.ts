import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

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
