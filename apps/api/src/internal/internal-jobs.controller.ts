import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildOutputObjectKey } from '../storage/file-validation';
import { JobsRepository } from '../jobs/jobs.repository';
import { CallbackAuthGuard } from './callback-auth.guard';
import { CompleteJobDto, FailJobDto } from './callback.dto';

@Controller('internal/jobs')
@UseGuards(CallbackAuthGuard)
export class InternalJobsController {
  private readonly logger = new Logger(InternalJobsController.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly config: ConfigService,
  ) {}

  @Post(':jobId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CompleteJobDto,
  ) {
    const expectedKey = buildOutputObjectKey(jobId, dto.attemptId);
    if (dto.outputKey !== expectedKey) {
      throw new BadRequestException('outputKey does not match job/attempt');
    }

    const { applied, job } = await this.jobs.acceptCompletion({
      jobId,
      attemptId: dto.attemptId,
      count: dto.count,
      outputKey: dto.outputKey,
    });

    this.logger.log(
      JSON.stringify({
        msg: applied ? 'job_completed' : 'job_complete_ignored',
        jobId,
        attemptId: dto.attemptId,
        count: dto.count,
        status: job.status,
      }),
    );

    return { ok: true, applied, status: job.status };
  }

  @Post(':jobId/fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: FailJobDto,
  ) {
    const maxAttempts = this.config.get<number>('jobs.maxAttempts') ?? 3;
    const retryBackoffMs = this.config.get<number>('jobs.retryBackoffMs') ?? 15000;

    const { applied, job, terminal } = await this.jobs.acceptFailure({
      jobId,
      attemptId: dto.attemptId,
      code: dto.code,
      message: dto.message,
      maxAttempts,
      retryBackoffMs,
    });

    this.logger.log(
      JSON.stringify({
        msg: applied ? 'job_failed_callback' : 'job_fail_ignored',
        jobId,
        attemptId: dto.attemptId,
        code: dto.code,
        status: job.status,
        terminal,
      }),
    );

    return { ok: true, applied, status: job.status, terminal };
  }
}
