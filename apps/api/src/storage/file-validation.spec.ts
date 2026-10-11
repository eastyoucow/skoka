import {
  buildInputObjectKey,
  buildOutputObjectKey,
  validateImageUpload,
} from './file-validation';

function jpegFixture(size = 64): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

describe('file-validation', () => {
  const options = {
    maxBytes: 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  };

  it('accepts a jpeg buffer', () => {
    const file = {
      buffer: jpegFixture(),
      mimetype: 'image/jpeg',
      size: 64,
    } as Express.Multer.File;

    const result = validateImageUpload(file, options);
    expect(result.extension).toBe('jpg');
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects missing file', () => {
    expect(() => validateImageUpload(undefined, options)).toThrow(
      'Image file is required',
    );
  });

  it('rejects oversized file', () => {
    const file = {
      buffer: jpegFixture(2000),
      mimetype: 'image/jpeg',
      size: 2000,
    } as Express.Multer.File;
    expect(() => validateImageUpload(file, options)).toThrow('max size');
  });

  it('rejects mismatched magic bytes', () => {
    const file = {
      buffer: Buffer.from('not-an-image'),
      mimetype: 'image/jpeg',
      size: 12,
    } as Express.Multer.File;
    expect(() => validateImageUpload(file, options)).toThrow(
      'does not match declared',
    );
  });

  it('builds R2 keys matching inference layout', () => {
    expect(buildInputObjectKey('abc', 'jpg')).toBe('jobs/abc/input.jpg');
    expect(buildOutputObjectKey('abc', 'att-1')).toBe(
      'jobs/abc/attempts/att-1/result.png',
    );
  });
});
