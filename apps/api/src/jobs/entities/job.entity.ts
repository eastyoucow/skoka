 import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobSource, JobStatus } from './job-status';
import { JobAttempt } from './job-attempt.entity';
import { Delivery } from './delivery.entity';

@Entity('jobs')
@Index('UQ_jobs_source_external_request_id', ['source', 'externalRequestId'], {
  unique: true,
})
@Index('IDX_jobs_status_next_attempt_at', ['status', 'nextAttemptAt'])
@Index('IDX_jobs_status_lease_until', ['status', 'leaseUntil'])
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: JobSource;

  @Column({ name: 'external_request_id', type: 'varchar', length: 255 })
  externalRequestId!: string;

  @Column({ type: 'varchar', length: 255 })
  prompt!: string;

  @Column({ type: 'varchar', length: 32, default: JobStatus.RECEIVED })
  status!: JobStatus;

  @Column({ name: 'input_key', type: 'varchar', length: 512, nullable: true })
  inputKey!: string | null;

  @Column({ name: 'output_key', type: 'varchar', length: 512, nullable: true })
  outputKey!: string | null;

  @Column({ name: 'object_count', type: 'int', nullable: true })
  objectCount!: number | null;

  @Column({ name: 'active_attempt_id', type: 'uuid', nullable: true })
  activeAttemptId!: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'deadline_at', type: 'timestamptz', nullable: true })
  deadlineAt!: Date | null;

  @OneToMany(() => JobAttempt, (attempt) => attempt.job)
  attempts!: JobAttempt[];

  @OneToMany(() => Delivery, (delivery) => delivery.job)
  deliveries!: Delivery[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
