import { Type } from 'class-transformer';
import { IsInt, IsIn, IsString, Max, Min } from 'class-validator';

export class CreateUploadDto {
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  contentLength!: number;
}
