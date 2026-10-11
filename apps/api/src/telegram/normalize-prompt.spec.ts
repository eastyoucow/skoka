import { normalizePrompt } from './telegram.service';

describe('normalizePrompt', () => {
  it('defaults when caption missing', () => {
    expect(normalizePrompt(undefined, 'person')).toBe('person');
    expect(normalizePrompt('  ', 'person')).toBe('person');
  });

  it('uses caption text', () => {
    expect(normalizePrompt('cat', 'person')).toBe('cat');
  });

  it('strips leading slash command', () => {
    expect(normalizePrompt('/count apple', 'person')).toBe('apple');
  });

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(80);
    expect(normalizePrompt(long, 'person').length).toBe(64);
  });
});
