import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateWebJobDto {
  @IsUUID()
  uploadId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  prompt!: string;
}
