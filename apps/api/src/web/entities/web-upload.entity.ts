import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WebUploadStatus {
  PENDING = 'pending',
  UPLOADED = 'uploaded',
  CONSUMED = 'consumed',
  EXPIRED = 'expired',
}

@Entity('web_uploads')
@Index('UQ_web_uploads_object_key', ['objectKey'], { unique: true })
@Index('IDX_web_uploads_session_status', ['sessionId', 'status'])
export class WebUpload {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 64 })
  contentType!: string;

  @Column({ name: 'byte_size', type: 'int' })
  byteSize!: number;

  @Column({ type: 'varchar', length: 32, default: WebUploadStatus.PENDING })
  status!: WebUploadStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
