import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DeliveryChannel, JobSource } from '../entities/job-status';

export class CreateJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  prompt!: string;

  @IsEnum(JobSource)
  source!: JobSource;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  externalRequestId!: string;

  @IsEnum(DeliveryChannel)
  channel!: DeliveryChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  recipientId!: string;

  /** Optional override; normally derived server-side after upload. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  inputKey?: string;
}
