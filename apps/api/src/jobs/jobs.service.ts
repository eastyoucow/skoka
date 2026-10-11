import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateJobDto } from './dto/create-job.dto';
import {
  DeliveryChannel,
  JobSource,
  JobStatus,
} from './entities/job-status';
import { Job } from './entities/job.entity';
import { JobsRepository } from './jobs.repository';
import { R2StorageService } from '../storage/r2.storage';
import {
  buildInputObjectKey,
  validateImageUpload,
} from '../storage/file-validation';

export interface CreateWithImageBufferParams {
  source: JobSource;
  externalRequestId: string;
  prompt: string;
  channel: DeliveryChannel;
  recipientId: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly storage: R2StorageService,
    private readonly config: ConfigService,
  ) {}

  async createWithUpload(
    dto: CreateJobDto,
    file: Express.Multer.File | undefined,
  ): Promise<{ job: Job; created: boolean }> {
    return this.createWithImageBuffer({
      source: dto.source,
      externalRequestId: dto.externalRequestId,
      prompt: dto.prompt,
      channel: dto.channel,
      recipientId: dto.recipientId,
      buffer: file?.buffer ?? Buffer.alloc(0),
      mimeType: file?.mimetype ?? '',
      originalName: file?.originalname,
    });
  }

  /**
   * Shared create path for HTTP multipart and Telegram downloads.
   * Idempotent on (source, externalRequestId). Ends at QUEUED after R2 put.
   */
  async createWithImageBuffer(
    params: CreateWithImageBufferParams,
  ): Promise<{ job: Job; created: boolean }> {
    const maxBytes = this.config.get<number>('uploads.maxBytes') ?? 10 * 1024 * 1024;
    const allowedMimeTypes =
      this.config.get<string[]>('uploads.allowedMimeTypes') ?? [
        'image/jpeg',
        'image/png',
        'image/webp',
      ];

    const fakeFile = {
      buffer: params.buffer,
      mimetype: params.mimeType,
      size: params.buffer.length,
      originalname: params.originalName ?? 'upload.bin',
    } as Express.Multer.File;

    const validated = validateImageUpload(fakeFile, { maxBytes, allowedMimeTypes });

    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Object storage (R2) is not configured');
    }

    const deadlineHours = this.config.get<number>('jobs.deadlineHours') ?? 12;
    const deadlineAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

    const { job, created } = await this.jobs.createReceivedJob({
      source: params.source,
      externalRequestId: params.externalRequestId,
      prompt: params.prompt,
      channel: params.channel,
      recipientId: params.recipientId,
      deadlineAt,
    });

    this.logger.log(
      JSON.stringify({
        msg: created ? 'job_created' : 'job_idempotent_hit',
        jobId: job.id,
        source: job.source,
        externalRequestId: job.externalRequestId,
        status: job.status,
      }),
    );

    // Idempotent replay: already has input / left RECEIVED — do not re-upload.
    if (!created && (job.inputKey || job.status !== JobStatus.RECEIVED)) {
      return { job, created: false };
    }

    const inputKey = buildInputObjectKey(job.id, validated.extension);

    try {
      await this.storage.putObject(inputKey, validated.buffer, validated.mimeType);
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          msg: 'r2_upload_failed',
          jobId: job.id,
          inputKey,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw new ServiceUnavailableException('Failed to store input image');
    }

    const queued = await this.jobs.markQueuedWithInput(job.id, inputKey);
    this.logger.log(
      JSON.stringify({
        msg: 'job_queued',
        jobId: queued.id,
        inputKey: queued.inputKey,
        status: queued.status,
      }),
    );

    return { job: queued, created };
  }

  async getById(id: string): Promise<Job> {
    const job = await this.jobs.findById(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return job;
  }

  /** Guard used when callers insist on creating a brand-new job. */
  async assertNewExternalId(
    source: CreateJobDto['source'],
    externalRequestId: string,
  ): Promise<void> {
    const existing = await this.jobs.findBySourceExternal(source, externalRequestId);
    if (existing) {
      throw new ConflictException(
        `Job already exists for ${source}/${externalRequestId}`,
      );
    }
  }
}
