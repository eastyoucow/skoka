import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

export interface ObjectPutResult {
  key: string;
  bucket: string;
}

export interface ObjectHeadResult {
  key: string;
  contentType: string | undefined;
  contentLength: number | undefined;
}

@Injectable()
export class R2StorageService implements OnModuleInit {
  private readonly logger = new Logger(R2StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const accessKeyId = this.config.get<string>('r2.accessKeyId') ?? '';
    const secretAccessKey = this.config.get<string>('r2.secretAccessKey') ?? '';
    const bucket = this.config.get<string>('r2.bucket') ?? '';
    const accountId = this.config.get<string>('r2.accountId') ?? '';
    const endpoint =
      this.config.get<string>('r2.endpoint') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

    if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
      this.logger.warn(
        'R2 is not fully configured; storage operations will fail until R2_* env vars are set',
      );
      this.configured = false;
      return;
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<ObjectPutResult> {
    this.assertConfigured();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, bucket: this.bucket };
  }

  async getObject(key: string): Promise<Buffer> {
    this.assertConfigured();
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return streamToBuffer(response.Body as Readable);
  }

  async deleteObject(key: string): Promise<void> {
    this.assertConfigured();
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async headObject(key: string): Promise<ObjectHeadResult | null> {
    this.assertConfigured();
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (err: unknown) {
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name: string }).name)
          : '';
      const status =
        err && typeof err === 'object' && '$metadata' in err
          ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return null;
      }
      throw err;
    }
  }

  async createPresignedPutUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    this.assertConfigured();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async createPresignedGetUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string> {
    this.assertConfigured();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async ping(): Promise<boolean> {
    if (!this.configured) {
      return false;
    }
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error('R2 storage is not configured');
    }
  }
}

async function streamToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
