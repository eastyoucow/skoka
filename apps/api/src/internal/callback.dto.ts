import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CompleteJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  attemptId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  count!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  outputKey!: string;
}

export class FailJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  attemptId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;
}
