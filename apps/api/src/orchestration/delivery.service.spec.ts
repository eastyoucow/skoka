import { ConfigService } from '@nestjs/config';
import { Delivery } from '../jobs/entities/delivery.entity';
import { DeliveryStatus, JobStatus } from '../jobs/entities/job-status';
import { Job } from '../jobs/entities/job.entity';
import { JobsRepository } from '../jobs/jobs.repository';
import { R2StorageService } from '../storage/r2.storage';
import { TelegramClient } from '../telegram/telegram.client';
import {
  DeliveryService,
  formatFailureMessage,
  formatSuccessCaption,
} from './delivery.service';

describe('DeliveryService', () => {
  const leaseMs = 60_000;
  let jobs: jest.Mocked<
    Pick<
      JobsRepository,
      | 'claimPendingDelivery'
      | 'findById'
      | 'markDeliverySent'
      | 'markDeliveryRetryOrFail'
    >
  >;
  let storage: jest.Mocked<Pick<R2StorageService, 'getObject'>>;
  let telegram: jest.Mocked<
    Pick<TelegramClient, 'isConfigured' | 'sendPhoto' | 'sendText'>
  >;
  let configGet: jest.Mock;
  let service: DeliveryService;

  beforeEach(() => {
    jobs = {
      claimPendingDelivery: jest.fn(),
      findById: jest.fn(),
      markDeliverySent: jest.fn(),
      markDeliveryRetryOrFail: jest.fn(),
    };
    storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('png')),
    };
    telegram = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: '99' }),
      sendText: jest.fn().mockResolvedValue({ messageId: '100' }),
    };
    configGet = jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'delivery.enabled': false,
        'delivery.maxConcurrent': 2,
        'delivery.pollIntervalMs': 2000,
        'delivery.leaseMs': leaseMs,
        'delivery.maxAttempts': 5,
        'delivery.retryBackoffMs': 1000,
      };
      return map[key];
    });
    service = new DeliveryService(
      jobs as unknown as JobsRepository,
      storage as unknown as R2StorageService,
      telegram as unknown as TelegramClient,
      { get: configGet } as unknown as ConfigService,
    );
  });

  function pendingDelivery(): Delivery {
    return {
      id: 'del-1',
      jobId: 'job-1',
      recipientId: '42',
      status: DeliveryStatus.SENDING,
      attempts: 1,
      createdAt: new Date(Date.now() - 5000),
    } as Delivery;
  }

  it('sends result photo for COMPLETED jobs and marks SENT', async () => {
    jobs.claimPendingDelivery
      .mockResolvedValueOnce(pendingDelivery())
      .mockResolvedValueOnce(null);
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      status: JobStatus.COMPLETED,
      prompt: 'cat',
      objectCount: 3,
      outputKey: 'jobs/job-1/attempts/a1/result.png',
    } as Job);

    await service.tick();

    expect(jobs.claimPendingDelivery).toHaveBeenCalledWith(leaseMs);
    expect(storage.getObject).toHaveBeenCalledWith(
      'jobs/job-1/attempts/a1/result.png',
    );
    expect(telegram.sendPhoto).toHaveBeenCalledWith(
      '42',
      expect.any(Buffer),
      'Found 3 “cat”.',
    );
    expect(jobs.markDeliverySent).toHaveBeenCalledWith('del-1', '99');
  });

  it('sends failure text for FAILED jobs without touching R2', async () => {
    jobs.claimPendingDelivery
      .mockResolvedValueOnce(pendingDelivery())
      .mockResolvedValueOnce(null);
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      status: JobStatus.FAILED,
      prompt: 'person',
    } as Job);

    await service.tick();

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(telegram.sendText).toHaveBeenCalledWith(
      '42',
      formatFailureMessage('person'),
    );
    expect(jobs.markDeliverySent).toHaveBeenCalledWith('del-1', '100');
  });

  it('retries delivery on Telegram failure without re-queuing inference', async () => {
    jobs.claimPendingDelivery
      .mockResolvedValueOnce(pendingDelivery())
      .mockResolvedValueOnce(null);
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      status: JobStatus.COMPLETED,
      prompt: 'dog',
      objectCount: 1,
      outputKey: 'jobs/job-1/attempts/a1/result.png',
    } as Job);
    telegram.sendPhoto.mockRejectedValueOnce(new Error('telegram 429'));
    jobs.markDeliveryRetryOrFail.mockResolvedValue({
      delivery: { attempts: 1 } as Delivery,
      terminal: false,
    });

    await service.tick();

    expect(jobs.markDeliverySent).not.toHaveBeenCalled();
    expect(jobs.markDeliveryRetryOrFail).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        error: 'telegram 429',
      }),
    );
  });

  it('does not claim when Telegram is not configured', async () => {
    telegram.isConfigured.mockReturnValue(false);
    await service.tick();
    expect(jobs.claimPendingDelivery).not.toHaveBeenCalled();
  });
});

describe('delivery copy', () => {
  it('formats success caption', () => {
    expect(formatSuccessCaption(0, 'person')).toBe('Found 0 “person”.');
    expect(formatSuccessCaption(2, 'cat')).toBe('Found 2 “cat”.');
  });
});
