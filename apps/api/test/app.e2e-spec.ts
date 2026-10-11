import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DeliveryService } from '../src/orchestration/delivery.service';
import { DispatcherService } from '../src/orchestration/dispatcher.service';
import { RecoveryService } from '../src/orchestration/recovery.service';
import { ModalInferenceClient } from '../src/modal/modal.client';
import { R2StorageService } from '../src/storage/r2.storage';
import { DeliveryStatus, JobSource, JobStatus } from '../src/jobs/entities/job-status';
import { JobsRepository } from '../src/jobs/jobs.repository';
import { TelegramClient } from '../src/telegram/telegram.client';

const runDbTests = process.env.API_RUN_DB_E2E === '1';

function signBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody)
    .digest('hex');
}

(runDbTests ? describe : describe.skip)('API e2e (Postgres)', () => {
  let app: INestApplication<App>;
  const putObject = jest.fn().mockResolvedValue({ key: 'x', bucket: 'b' });
  const getObject = jest.fn().mockResolvedValue(Buffer.from('fake-png'));
  const spawn = jest.fn().mockResolvedValue({ callId: 'fc-e2e-1' });
  const sendPhoto = jest.fn().mockResolvedValue({ messageId: '501' });
  const sendText = jest.fn().mockResolvedValue({ messageId: '502' });
  const callbackSecret = 'e2e-callback-secret';
  const webhookSecret = 'e2e-telegram-secret';

  beforeAll(async () => {
    process.env.CALLBACK_SHARED_SECRET = callbackSecret;
    process.env.TELEGRAM_WEBHOOK_SECRET = webhookSecret;
    process.env.TELEGRAM_BOT_TOKEN = '000000:e2e-token';
    process.env.PUBLIC_BASE_URL = 'https://api.example.com';
    process.env.DISPATCHER_ENABLED = 'false';
    process.env.RECOVERY_ENABLED = 'false';
    process.env.DELIVERY_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(R2StorageService)
      .useValue({
        isConfigured: () => true,
        putObject,
        getObject,
        deleteObject: jest.fn(),
        ping: jest.fn().mockResolvedValue(true),
        onModuleInit: () => undefined,
      })
      .overrideProvider(ModalInferenceClient)
      .useValue({
        isConfigured: () => true,
        spawn,
        onModuleInit: () => undefined,
      })
      .overrideProvider(TelegramClient)
      .useValue({
        isConfigured: () => true,
        onModuleInit: () => undefined,
        getFile: jest.fn().mockResolvedValue({
          file_id: 'f1',
          file_unique_id: 'u1',
          file_path: 'photos/file_1.jpg',
        }),
        downloadFile: jest.fn().mockResolvedValue(
          Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(28, 1)]),
        ),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        sendPhoto,
        sendText,
      })
      .overrideProvider(DispatcherService)
      .useValue({
        onModuleInit: () => undefined,
        onModuleDestroy: () => undefined,
        tick: jest.fn(),
      })
      .overrideProvider(RecoveryService)
      .useValue({
        onModuleInit: () => undefined,
        onModuleDestroy: () => undefined,
        tick: jest.fn(),
      })
      .overrideProvider(DeliveryService)
      .useValue({
        onModuleInit: () => undefined,
        onModuleDestroy: () => undefined,
        tick: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      status: 'ok',
    });
  });

  it('/health/ready (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('creates a job with mocked R2 and reads it back', async () => {
    const jpeg = Buffer.alloc(32, 0);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;

    const externalRequestId = `e2e-${Date.now()}`;
    const create = await request(app.getHttpServer())
      .post('/api/jobs')
      .field('prompt', 'person')
      .field('source', 'web')
      .field('externalRequestId', externalRequestId)
      .field('channel', 'web')
      .field('recipientId', 'user-1')
      .attach('file', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });

    expect(create.status).toBe(201);
    expect(create.body.status).toBe('QUEUED');
    expect(create.body.inputKey).toMatch(/^jobs\/.+\/input\.jpg$/);
    expect(putObject).toHaveBeenCalled();

    const get = await request(app.getHttpServer()).get(
      `/api/jobs/${create.body.id}`,
    );
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(create.body.id);
    expect(get.body.status).toBe('QUEUED');
  });

  it('dedupes repeated Telegram updates by update_id', async () => {
    const updateId = Date.now();
    const body = {
      update_id: updateId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 42, type: 'private' },
        caption: 'cat',
        photo: [
          {
            file_id: 'small',
            file_unique_id: 's',
            width: 90,
            height: 90,
          },
          {
            file_id: 'large',
            file_unique_id: 'l',
            width: 800,
            height: 600,
          },
        ],
      },
    };

    const first = await request(app.getHttpServer())
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret)
      .send(body);
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret)
      .send(body);
    expect(second.status).toBe(200);

    const jobs = app.get(JobsRepository);
    const job = await jobs.findBySourceExternal(
      JobSource.TELEGRAM,
      String(updateId),
    );
    expect(job).toBeTruthy();
    expect(job!.prompt).toBe('cat');
    expect(job!.status).toBe('QUEUED');
  });

  it('rejects Telegram webhook without secret', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/telegram')
      .send({ update_id: 1 })
      .expect(401);
  });

  it('completes via signed callback for active attempt; ignores stale attempt', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(28, 2)]);
    const create = await request(app.getHttpServer())
      .post('/api/jobs')
      .field('prompt', 'person')
      .field('source', 'web')
      .field('externalRequestId', `cb-${Date.now()}`)
      .field('channel', 'web')
      .field('recipientId', 'user-cb')
      .attach('file', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });

    expect(create.status).toBe(201);
    const jobId = create.body.id as string;

    const jobs = app.get(JobsRepository);
    const claimed = await jobs.claimQueuedJobById(jobId, 60_000);
    expect(claimed).toBeTruthy();
    const attemptId = claimed!.attempt.id;

    const outputKey = `jobs/${jobId}/attempts/${attemptId}/result.png`;
    const completeBody = JSON.stringify({
      attemptId,
      count: 3,
      outputKey,
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(callbackSecret, ts, completeBody);

    const complete = await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts)
      .set('X-Skoka-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(completeBody);

    expect(complete.status).toBe(200);
    expect(complete.body.applied).toBe(true);
    expect(complete.body.status).toBe('COMPLETED');

    // Duplicate complete — still 200, no regression.
    const ts2 = String(Math.floor(Date.now() / 1000));
    const sig2 = signBody(callbackSecret, ts2, completeBody);
    const dup = await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts2)
      .set('X-Skoka-Signature', sig2)
      .set('Content-Type', 'application/json')
      .send(completeBody);
    expect(dup.status).toBe(200);
    expect(dup.body.applied).toBe(false);

    // Stale attempt callback after completion.
    const staleBody = JSON.stringify({
      attemptId: '00000000-0000-4000-8000-000000000099',
      count: 9,
      outputKey: `jobs/${jobId}/attempts/00000000-0000-4000-8000-000000000099/result.png`,
    });
    const ts3 = String(Math.floor(Date.now() / 1000));
    const sig3 = signBody(callbackSecret, ts3, staleBody);
    const stale = await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts3)
      .set('X-Skoka-Signature', sig3)
      .set('Content-Type', 'application/json')
      .send(staleBody);
    expect(stale.status).toBe(200);
    expect(stale.body.applied).toBe(false);

    const job = await jobs.findById(jobId);
    expect(job!.status).toBe('COMPLETED');
    expect(job!.objectCount).toBe(3);
    expect(job!.outputKey).toBe(outputKey);

    const delivery = await jobs.findDeliveryByJobId(jobId);
    expect(delivery).toBeTruthy();
    expect(delivery!.status).toBe(DeliveryStatus.PENDING);
    expect(delivery!.nextRetryAt).toBeTruthy();
  });

  it(
    'delivery loop sends photo after completion and does not re-dispatch on send failure',
    async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(28, 4)]);
    const create = await request(app.getHttpServer())
      .post('/api/jobs')
      .field('prompt', 'apple')
      .field('source', 'telegram')
      .field('externalRequestId', `del-${Date.now()}`)
      .field('channel', 'telegram')
      .field('recipientId', '777')
      .attach('file', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });

    const jobId = create.body.id as string;
    const jobs = app.get(JobsRepository);
    const claimed = await jobs.claimQueuedJobById(jobId, 60_000);
    const attemptId = claimed!.attempt.id;
    const outputKey = `jobs/${jobId}/attempts/${attemptId}/result.png`;
    const completeBody = JSON.stringify({ attemptId, count: 2, outputKey });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(callbackSecret, ts, completeBody);

    await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts)
      .set('X-Skoka-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(completeBody)
      .expect(200);

    const realDelivery = new DeliveryService(
      jobs,
      app.get(R2StorageService),
      app.get(TelegramClient),
      app.get(ConfigService),
    );
    await realDelivery.tick();

    expect(getObject).toHaveBeenCalledWith(outputKey);
    expect(sendPhoto).toHaveBeenCalled();
    const delivery = await jobs.findDeliveryByJobId(jobId);
    expect(delivery!.status).toBe(DeliveryStatus.SENT);
    expect(delivery!.externalMessageId).toBe('501');

    // Send failure path: arm another job, force Telegram error, ensure job stays COMPLETED.
    sendPhoto.mockRejectedValueOnce(new Error('timeout'));
    const create2 = await request(app.getHttpServer())
      .post('/api/jobs')
      .field('prompt', 'apple')
      .field('source', 'telegram')
      .field('externalRequestId', `del-fail-${Date.now()}`)
      .field('channel', 'telegram')
      .field('recipientId', '778')
      .attach('file', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });
    const jobId2 = create2.body.id as string;
    const claimed2 = await jobs.claimQueuedJobById(jobId2, 60_000);
    const attemptId2 = claimed2!.attempt.id;
    const outputKey2 = `jobs/${jobId2}/attempts/${attemptId2}/result.png`;
    const body2 = JSON.stringify({
      attemptId: attemptId2,
      count: 1,
      outputKey: outputKey2,
    });
    const ts2 = String(Math.floor(Date.now() / 1000));
    const sig2 = signBody(callbackSecret, ts2, body2);
    await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId2}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts2)
      .set('X-Skoka-Signature', sig2)
      .set('Content-Type', 'application/json')
      .send(body2)
      .expect(200);

    const spawnCallsBefore = spawn.mock.calls.length;
    await realDelivery.tick();
    const job2 = await jobs.findById(jobId2);
    expect(job2!.status).toBe(JobStatus.COMPLETED);
    const delivery2 = await jobs.findDeliveryByJobId(jobId2);
    expect(delivery2!.status).toBe(DeliveryStatus.PENDING);
    expect(delivery2!.nextRetryAt).toBeTruthy();
    // Delivery failure must never trigger Modal again.
    expect(spawn.mock.calls.length).toBe(spawnCallsBefore);
  },
    30_000,
  );

  it('ignores complete callback that arrives for non-active attempt (callback-before-ack race)', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(28, 3)]);
    const create = await request(app.getHttpServer())
      .post('/api/jobs')
      .field('prompt', 'person')
      .field('source', 'web')
      .field('externalRequestId', `race-${Date.now()}`)
      .field('channel', 'web')
      .field('recipientId', 'user-race')
      .attach('file', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });

    const jobId = create.body.id as string;
    const jobs = app.get(JobsRepository);
    const claimed = await jobs.claimQueuedJobById(jobId, 60_000);
    expect(claimed).toBeTruthy();

    // Simulate crash-after-submit: mark submitted, then complete before any ack race.
    await jobs.markAttemptSubmitted(claimed!.attempt.id, 'fc-race');
    const attemptId = claimed!.attempt.id;
    const outputKey = `jobs/${jobId}/attempts/${attemptId}/result.png`;
    const completeBody = JSON.stringify({ attemptId, count: 1, outputKey });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(callbackSecret, ts, completeBody);

    const res = await request(app.getHttpServer())
      .post(`/internal/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${callbackSecret}`)
      .set('X-Skoka-Timestamp', ts)
      .set('X-Skoka-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(completeBody);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    // Persisting modal_call_id after completion must not regress status.
    await jobs.markAttemptSubmitted(attemptId, 'fc-race-late');
    const job = await jobs.findById(jobId);
    expect(job!.status).toBe('COMPLETED');
  });
});
