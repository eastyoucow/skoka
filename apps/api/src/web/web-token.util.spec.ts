import {
  generateSessionToken,
  hashSessionToken,
  hashWebRequest,
} from './web-token.util';

describe('web-token.util', () => {
  it('generates unique base64url tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hashes tokens to stable 64-char hex', () => {
    const token = 'test-token';
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toEqual(hashSessionToken(token));
    expect(hash).not.toEqual(hashSessionToken('other'));
  });

  it('hashes web requests case-insensitively on prompt', () => {
    const a = hashWebRequest('Person', 'upload-1');
    const b = hashWebRequest('person', 'upload-1');
    const c = hashWebRequest('person', 'upload-2');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
