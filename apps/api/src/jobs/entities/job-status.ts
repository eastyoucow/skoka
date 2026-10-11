export enum JobStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum JobSource {
  TELEGRAM = 'telegram',
  WEB = 'web',
}

export enum AttemptStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum DeliveryChannel {
  TELEGRAM = 'telegram',
  WEB = 'web',
}

/** Legal job status transitions for Phase 3+ orchestration. */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  [JobStatus.RECEIVED]: [JobStatus.QUEUED, JobStatus.FAILED],
  [JobStatus.QUEUED]: [JobStatus.PROCESSING, JobStatus.FAILED],
  [JobStatus.PROCESSING]: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.QUEUED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [],
};

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!JOB_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal job status transition: ${from} -> ${to}`);
  }
}
