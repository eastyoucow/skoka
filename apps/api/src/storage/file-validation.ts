import { BadRequestException } from '@nestjs/common';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  size: number;
}

export function validateImageUpload(
  file: Express.Multer.File | undefined,
  options: { maxBytes: number; allowedMimeTypes: string[] },
): ValidatedUpload {
  if (!file) {
    throw new BadRequestException('Image file is required');
  }

  const mimeType = file.mimetype?.toLowerCase();
  if (!mimeType || !options.allowedMimeTypes.includes(mimeType)) {
    throw new BadRequestException(
      `Unsupported image type. Allowed: ${options.allowedMimeTypes.join(', ')}`,
    );
  }

  const extension = EXT_BY_MIME[mimeType];
  if (!extension) {
    throw new BadRequestException(`No extension mapping for mime type ${mimeType}`);
  }

  if (!file.buffer?.length) {
    throw new BadRequestException('Empty image upload');
  }

  if (file.size > options.maxBytes) {
    throw new BadRequestException(
      `Image exceeds max size of ${options.maxBytes} bytes`,
    );
  }

  // Lightweight magic-byte check for common formats.
  if (!looksLikeImage(file.buffer, mimeType)) {
    throw new BadRequestException('File content does not match declared image type');
  }

  return {
    buffer: file.buffer,
    mimeType,
    extension,
    size: file.size,
  };
}

export function buildInputObjectKey(jobId: string, extension: string): string {
  return `jobs/${jobId}/input.${extension}`;
}

export function buildOutputObjectKey(jobId: string, attemptId: string): string {
  return `jobs/${jobId}/attempts/${attemptId}/result.png`;
}

function looksLikeImage(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8;
  }
  if (mimeType === 'image/png') {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (mimeType === 'image/webp') {
    return (
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}
