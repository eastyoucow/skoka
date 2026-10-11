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
import { DeliveryChannel, DeliveryStatus } from './job-status';
import { Job } from './job.entity';

@Entity('deliveries')
@Index('UQ_deliveries_job_channel_recipient', ['jobId', 'channel', 'recipientId'], {
  unique: true,
})
@Index('IDX_deliveries_status_next_retry_at', ['status', 'nextRetryAt'])
@Index('IDX_deliveries_status_lease_until', ['status', 'leaseUntil'])
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @ManyToOne(() => Job, (job) => job.deliveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ type: 'varchar', length: 32 })
  channel!: DeliveryChannel;

  @Column({ name: 'recipient_id', type: 'varchar', length: 255 })
  recipientId!: string;

  @Column({ type: 'varchar', length: 32, default: DeliveryStatus.PENDING })
  status!: DeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'external_message_id', type: 'varchar', length: 255, nullable: true })
  externalMessageId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
