import { createHash, randomBytes } from 'crypto';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashWebRequest(prompt: string, uploadId: string): string {
  return createHash('sha256')
    .update(`${prompt.trim().toLowerCase()}\n${uploadId}`, 'utf8')
    .digest('hex');
}
