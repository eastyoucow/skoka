import { ConfigService } from '@nestjs/config';
import { DispatcherService } from './dispatcher.service';
import { JobsRepository } from '../jobs/jobs.repository';
import { ModalInferenceClient } from '../modal/modal.client';
import { AttemptStatus, JobStatus } from '../jobs/entities/job-status';
import { Job } from '../jobs/entities/job.entity';
import { JobAttempt } from '../jobs/entities/job-attempt.entity';

describe('DispatcherService', () => {
  const leaseMs = 60_000;
  let jobs: jest.Mocked<Pick<
    JobsRepository,
    'claimQueuedJob' | 'markAttemptSubmitted' | 'failSubmitAndMaybeRequeue'
  >>;
  let modal: jest.Mocked<Pick<ModalInferenceClient, 'isConfigured' | 'spawn'>>;
  let configGet: jest.Mock;
  let service: DispatcherService;

  beforeEach(() => {
    jobs = {
      claimQueuedJob: jest.fn(),
      markAttemptSubmitted: jest.fn(),
      failSubmitAndMaybeRequeue: jest.fn(),
    };
    modal = {
      isConfigured: jest.fn().mockReturnValue(true),
      spawn: jest.fn().mockResolvedValue({ callId: 'fc-123' }),
    };
    configGet = jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'dispatcher.enabled': false, // prevent onModuleInit timer
        'dispatcher.maxConcurrent': 2,
        'dispatcher.pollIntervalMs': 2000,
        publicBaseUrl: 'https://api.example.com',
        'jobs.leaseMs': leaseMs,
        'jobs.maxAttempts': 3,
        'jobs.retryBackoffMs': 1000,
      };
      return map[key];
    });
    service = new DispatcherService(
      jobs as unknown as JobsRepository,
      modal as unknown as ModalInferenceClient,
      { get: configGet } as unknown as ConfigService,
    );
  });

  function queuedClaim(): { job: Job; attempt: JobAttempt } {
    return {
      job: {
        id: 'job-1',
        status: JobStatus.PROCESSING,
        inputKey: 'jobs/job-1/input.jpg',
        prompt: 'person',
      } as Job,
      attempt: {
        id: 'attempt-1',
        jobId: 'job-1',
        attemptNumber: 1,
        status: AttemptStatus.PENDING,
      } as JobAttempt,
    };
  }

  it('claims, spawns Modal, then persists modal_call_id (no TX over network)', async () => {
    jobs.claimQueuedJob.mockResolvedValueOnce(queuedClaim()).mockResolvedValueOnce(null);

    await service.tick();

    expect(jobs.claimQueuedJob).toHaveBeenCalledWith(leaseMs);
    expect(modal.spawn).toHaveBeenCalledWith({
      jobId: 'job-1',
      attemptId: 'attempt-1',
      inputKey: 'jobs/job-1/input.jpg',
      prompt: 'person',
      outputKey: 'jobs/job-1/attempts/attempt-1/result.png',
      callbackUrl: 'https://api.example.com',
    });
    expect(jobs.markAttemptSubmitted).toHaveBeenCalledWith('attempt-1', 'fc-123');
  });

  it('re-queues when Modal spawn fails', async () => {
    jobs.claimQueuedJob.mockResolvedValueOnce(queuedClaim()).mockResolvedValueOnce(null);
    modal.spawn.mockRejectedValueOnce(new Error('modal down'));

    await service.tick();

    expect(jobs.failSubmitAndMaybeRequeue).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        error: 'modal down',
      }),
    );
    expect(jobs.markAttemptSubmitted).not.toHaveBeenCalled();
  });

  it('does not claim when PUBLIC_BASE_URL is missing', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'publicBaseUrl') return '';
      if (key === 'dispatcher.maxConcurrent') return 2;
      return undefined;
    });

    await service.tick();
    expect(jobs.claimQueuedJob).not.toHaveBeenCalled();
  });
});
