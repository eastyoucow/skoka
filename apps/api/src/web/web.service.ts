import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeliveryChannel,
  JobSource,
  JobStatus,
} from '../jobs/entities/job-status';
import { Job } from '../jobs/entities/job.entity';
import { JobsRepository } from '../jobs/jobs.repository';
import {
  buildWebUploadObjectKey,
  extensionForMime,
} from '../storage/file-validation';
import { R2StorageService } from '../storage/r2.storage';
import { WebJobRequest } from './entities/web-job-request.entity';
import { WebSession } from './entities/web-session.entity';
import {
  WebUpload,
  WebUploadStatus,
} from './entities/web-upload.entity';
import { hashWebRequest } from './web-token.util';

@Injectable()
export class WebService {
  private readonly logger = new Logger(WebService.name);

  constructor(
    @InjectRepository(WebUpload)
    private readonly uploads: Repository<WebUpload>,
    @InjectRepository(WebJobRequest)
    private readonly jobRequests: Repository<WebJobRequest>,
    private readonly jobs: JobsRepository,
    private readonly storage: R2StorageService,
    private readonly config: ConfigService,
  ) {}

  async createUpload(
    session: WebSession,
    contentType: string,
    contentLength: number,
  ): Promise<{
    uploadId: string;
    putUrl: string;
    headers: Record<string, string>;
    expiresAt: Date;
  }> {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Object storage (R2) is not configured');
    }

    const maxBytes =
      this.config.get<number>('uploads.maxBytes') ?? 10 * 1024 * 1024;
    const allowed =
      this.config.get<string[]>('uploads.allowedMimeTypes') ?? [
        'image/jpeg',
        'image/png',
        'image/webp',
      ];

    if (!allowed.includes(contentType)) {
      throw new BadRequestException(
        `Unsupported image type. Allowed: ${allowed.join(', ')}`,
      );
    }
    if (contentLength > maxBytes) {
      throw new BadRequestException(
        `Image exceeds max size of ${maxBytes} bytes`,
      );
    }

    const extension = extensionForMime(contentType);
    if (!extension) {
      throw new BadRequestException(`No extension mapping for ${contentType}`);
    }

    const ttlSeconds =
      this.config.get<number>('web.uploadUrlTtlSeconds') ?? 900;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const upload = this.uploads.create({
      sessionId: session.id,
      objectKey: 'pending',
      contentType,
      byteSize: contentLength,
      status: WebUploadStatus.PENDING,
      expiresAt,
    });
    const saved = await this.uploads.save(upload);
    const objectKey = buildWebUploadObjectKey(session.id, saved.id, extension);
    saved.objectKey = objectKey;
    await this.uploads.save(saved);

    const putUrl = await this.storage.createPresignedPutUrl(
      objectKey,
      contentType,
      ttlSeconds,
    );

    this.logger.log(
      JSON.stringify({
        msg: 'web_upload_presigned',
        uploadId: saved.id,
        sessionId: session.id,
        contentType,
        contentLength,
      }),
    );

    return {
      uploadId: saved.id,
      putUrl,
      headers: { 'Content-Type': contentType },
      expiresAt,
    };
  }

  async createJob(
    session: WebSession,
    uploadId: string,
    prompt: string,
    idempotencyKey: string,
  ): Promise<{ job: Job; created: boolean }> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (idempotencyKey.length > 128) {
      throw new BadRequestException('Idempotency-Key is too long');
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new BadRequestException('Prompt is required');
    }

    const requestHash = hashWebRequest(trimmedPrompt, uploadId);
    const existingReq = await this.jobRequests.findOne({
      where: { sessionId: session.id, idempotencyKey },
    });
    if (existingReq) {
      if (existingReq.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different request',
        );
      }
      const existingJob = await this.jobs.findById(existingReq.jobId);
      if (!existingJob) {
        throw new NotFoundException('Idempotent job missing');
      }
      return { job: existingJob, created: false };
    }

    await this.assertSessionConcurrency(session.id);

    const upload = await this.uploads.findOne({ where: { id: uploadId } });
    if (!upload || upload.sessionId !== session.id) {
      throw new ForbiddenException('Upload not found for this session');
    }
    if (
      upload.status === WebUploadStatus.CONSUMED ||
      upload.status === WebUploadStatus.EXPIRED
    ) {
      throw new ConflictException('Upload has already been used or expired');
    }
    if (upload.expiresAt.getTime() <= Date.now()) {
      upload.status = WebUploadStatus.EXPIRED;
      await this.uploads.save(upload);
      throw new BadRequestException('Upload URL has expired');
    }

    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Object storage (R2) is not configured');
    }

    const head = await this.storage.headObject(upload.objectKey);
    if (!head) {
      throw new BadRequestException('Upload not found in storage; complete PUT first');
    }
    const maxBytes =
      this.config.get<number>('uploads.maxBytes') ?? 10 * 1024 * 1024;
    if (head.contentLength != null && head.contentLength > maxBytes) {
      throw new BadRequestException('Uploaded object exceeds max size');
    }
    if (
      head.contentType &&
      head.contentType.toLowerCase() !== upload.contentType.toLowerCase()
    ) {
      throw new BadRequestException('Uploaded Content-Type does not match');
    }

    upload.status = WebUploadStatus.UPLOADED;
    await this.uploads.save(upload);

    const deadlineHours = this.config.get<number>('jobs.deadlineHours') ?? 12;
    const deadlineAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);
    const externalRequestId = `${session.id}:${idempotencyKey}`;

    let job: Job;
    let created: boolean;
    try {
      ({ job, created } = await this.jobs.createReceivedJob({
        source: JobSource.WEB,
        externalRequestId,
        prompt: trimmedPrompt,
        channel: DeliveryChannel.WEB,
        recipientId: session.id,
        deadlineAt,
      }));
    } catch (err: unknown) {
      // Concurrent insert race on (source, external_request_id).
      const existing = await this.jobs.findBySourceExternal(
        JobSource.WEB,
        externalRequestId,
      );
      if (existing) {
        return { job: existing, created: false };
      }
      throw err;
    }

    if (!created && (job.inputKey || job.status !== JobStatus.RECEIVED)) {
      await this.rememberIdempotency(session.id, idempotencyKey, requestHash, job.id);
      return { job, created: false };
    }

    const queued = await this.jobs.markQueuedWithInput(job.id, upload.objectKey);
    upload.status = WebUploadStatus.CONSUMED;
    upload.jobId = queued.id;
    await this.uploads.save(upload);

    try {
      await this.rememberIdempotency(
        session.id,
        idempotencyKey,
        requestHash,
        queued.id,
      );
    } catch (err: unknown) {
      const raced = await this.jobRequests.findOne({
        where: { sessionId: session.id, idempotencyKey },
      });
      if (raced) {
        if (raced.requestHash !== requestHash) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different request',
          );
        }
        const existingJob = await this.jobs.findById(raced.jobId);
        if (existingJob) {
          return { job: existingJob, created: false };
        }
      }
      throw err;
    }

    this.logger.log(
      JSON.stringify({
        msg: 'web_job_created',
        jobId: queued.id,
        sessionId: session.id,
        uploadId: upload.id,
        created: true,
      }),
    );

    // Hook point for future Cloudflare Turnstile verification on job create.
    return { job: queued, created: true };
  }

  async getJobForSession(session: WebSession, jobId: string): Promise<Job> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    this.assertOwnsJob(session, job);
    return job;
  }

  async getResultUrls(
    session: WebSession,
    jobId: string,
  ): Promise<{
    status: JobStatus;
    objectCount: number | null;
    resultUrl: string;
    resultUrlExpiresAt: Date;
    inputUrl?: string;
  }> {
    const job = await this.getJobForSession(session, jobId);
    if (job.status !== JobStatus.COMPLETED) {
      throw new ConflictException('Job is not completed yet');
    }
    if (!job.outputKey) {
      throw new ServiceUnavailableException('Result is not available');
    }
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Object storage (R2) is not configured');
    }

    const ttl =
      this.config.get<number>('web.resultUrlTtlSeconds') ?? 300;
    const resultUrl = await this.storage.createPresignedGetUrl(
      job.outputKey,
      ttl,
    );
    const resultUrlExpiresAt = new Date(Date.now() + ttl * 1000);

    let inputUrl: string | undefined;
    if (job.inputKey) {
      inputUrl = await this.storage.createPresignedGetUrl(job.inputKey, ttl);
    }

    return {
      status: job.status,
      objectCount: job.objectCount,
      resultUrl,
      resultUrlExpiresAt,
      inputUrl,
    };
  }

  toPublicJob(job: Job, created?: boolean) {
    return {
      id: job.id,
      prompt: job.prompt,
      status: job.status,
      objectCount: job.objectCount,
      deadlineAt: job.deadlineAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(created !== undefined ? { created } : {}),
    };
  }

  private assertOwnsJob(session: WebSession, job: Job): void {
    if (job.source !== JobSource.WEB) {
      throw new ForbiddenException('Job not found for this session');
    }
    const prefix = `${session.id}:`;
    if (!job.externalRequestId.startsWith(prefix)) {
      throw new ForbiddenException('Job not found for this session');
    }
  }

  private async assertSessionConcurrency(sessionId: string): Promise<void> {
    const max =
      this.config.get<number>('web.maxConcurrentJobsPerSession') ?? 1;
    if (max <= 0) {
      return;
    }
    const active = await this.jobs.countWebActiveForRecipient(sessionId, [
      JobStatus.RECEIVED,
      JobStatus.QUEUED,
      JobStatus.PROCESSING,
    ]);
    if (active >= max) {
      throw new HttpException(
        'Too many active jobs for this session',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async rememberIdempotency(
    sessionId: string,
    idempotencyKey: string,
    requestHash: string,
    jobId: string,
  ): Promise<void> {
    const row = this.jobRequests.create({
      sessionId,
      idempotencyKey,
      requestHash,
      jobId,
    });
    await this.jobRequests.save(row);
  }
}
