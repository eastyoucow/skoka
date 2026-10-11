import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { R2StorageService } from '../src/storage/r2.storage';

const runDbTests = process.env.API_RUN_DB_E2E === '1';

(runDbTests ? describe : describe.skip)('API e2e (Postgres)', () => {
  let app: INestApplication<App>;
  const putObject = jest.fn().mockResolvedValue({ key: 'x', bucket: 'b' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(R2StorageService)
      .useValue({
        isConfigured: () => true,
        putObject,
        getObject: jest.fn(),
        deleteObject: jest.fn(),
        ping: jest.fn().mockResolvedValue(true),
        onModuleInit: () => undefined,
      })
      .compile();

    app = moduleFixture.createNestApplication();
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
});
