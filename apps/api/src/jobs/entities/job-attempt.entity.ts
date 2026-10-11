import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttemptStatus } from './job-status';
import { Job } from './job.entity';

@Entity('job_attempts')
@Index('UQ_job_attempts_job_id_attempt_number', ['jobId', 'attemptNumber'], {
  unique: true,
})
export class JobAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @ManyToOne(() => Job, (job) => job.attempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'attempt_number', type: 'int' })
  attemptNumber!: number;

  @Column({ name: 'modal_call_id', type: 'varchar', length: 255, nullable: true })
  modalCallId!: string | null;

  @Column({ type: 'varchar', length: 32, default: AttemptStatus.PENDING })
  status!: AttemptStatus;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
