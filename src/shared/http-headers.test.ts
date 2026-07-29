import { describe, it, expect } from 'vitest';
import { headerToString } from './http-headers';

describe('headerToString', () => {
  it('returns empty string for undefined', () => {
    expect(headerToString(undefined)).toBe('');
  });

  it('returns a single string value', () => {
    expect(headerToString('text/html')).toBe('text/html');
  });

  it('joins array values with comma', () => {
    expect(headerToString(['a', 'b'])).toBe('a,b');
  });
});
