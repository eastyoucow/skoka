import { signPayload, verifyCallbackAuth } from './callback-auth';

describe('callback-auth', () => {
  const secret = 'test-shared-secret';
  const body = Buffer.from(
    JSON.stringify({
      attemptId: 'a1',
      count: 2,
      outputKey: 'jobs/j1/attempts/a1/result.png',
    }),
  );

  it('accepts a valid bearer + HMAC signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(secret, timestamp, body);
    const result = verifyCallbackAuth({
      secret,
      authorization: `Bearer ${secret}`,
      timestamp,
      signature,
      rawBody: body,
      maxSkewSeconds: 300,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects wrong bearer', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(secret, timestamp, body);
    const result = verifyCallbackAuth({
      secret,
      authorization: 'Bearer other',
      timestamp,
      signature,
      rawBody: body,
      maxSkewSeconds: 300,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects skewed timestamp', () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 1000);
    const signature = signPayload(secret, timestamp, body);
    const result = verifyCallbackAuth({
      secret,
      authorization: `Bearer ${secret}`,
      timestamp,
      signature,
      rawBody: body,
      maxSkewSeconds: 300,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects bad signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyCallbackAuth({
      secret,
      authorization: `Bearer ${secret}`,
      timestamp,
      signature: 'deadbeef',
      rawBody: body,
      maxSkewSeconds: 300,
    });
    expect(result.ok).toBe(false);
  });
});
