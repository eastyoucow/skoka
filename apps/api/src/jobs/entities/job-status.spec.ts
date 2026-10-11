import { JobStatus, assertJobTransition } from './job-status';

describe('job status transitions', () => {
  it('allows RECEIVED -> QUEUED', () => {
    expect(() =>
      assertJobTransition(JobStatus.RECEIVED, JobStatus.QUEUED),
    ).not.toThrow();
  });

  it('rejects COMPLETED -> PROCESSING', () => {
    expect(() =>
      assertJobTransition(JobStatus.COMPLETED, JobStatus.PROCESSING),
    ).toThrow(/Illegal job status transition/);
  });
});
