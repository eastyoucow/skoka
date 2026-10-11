import { createHmac, timingSafeEqual } from 'crypto';

export const HEADER_TIMESTAMP = 'x-skoka-timestamp';
export const HEADER_SIGNATURE = 'x-skoka-signature';

export function signPayload(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  const message = Buffer.concat([
    Buffer.from(timestamp, 'utf8'),
    Buffer.from('.', 'utf8'),
    rawBody,
  ]);
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function verifyCallbackAuth(params: {
  secret: string;
  authorization: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
  maxSkewSeconds: number;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret } = params;
  if (!secret) {
    return { ok: false, reason: 'callback secret not configured' };
  }

  const auth = params.authorization ?? '';
  const expectedBearer = `Bearer ${secret}`;
  if (!safeEqualString(auth, expectedBearer)) {
    return { ok: false, reason: 'invalid bearer token' };
  }

  const timestamp = params.timestamp ?? '';
  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: 'missing or invalid timestamp' };
  }

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - Number(timestamp));
  if (skew > params.maxSkewSeconds) {
    return { ok: false, reason: 'timestamp skew too large' };
  }

  const signature = (params.signature ?? '').toLowerCase();
  const expected = signPayload(secret, timestamp, params.rawBody);
  if (!safeEqualString(signature, expected)) {
    return { ok: false, reason: 'invalid signature' };
  }

  return { ok: true };
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
