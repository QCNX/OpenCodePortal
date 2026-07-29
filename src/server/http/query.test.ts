import { describe, it, expect } from 'vitest';
import { stripQueryParam } from './query';

describe('stripQueryParam', () => {
  it('removes the named param and keeps others', () => {
    const url = '/pty/id/connect?directory=%2Ftmp&auth_token=abc&cursor=0';
    expect(stripQueryParam(url, 'auth_token')).toBe('/pty/id/connect?directory=%2Ftmp&cursor=0');
  });

  it('returns path only when last param is removed', () => {
    expect(stripQueryParam('/pty/id/connect?auth_token=abc', 'auth_token')).toBe('/pty/id/connect');
  });

  it('returns url unchanged when param is absent', () => {
    const url = '/api/test?foo=bar';
    expect(stripQueryParam(url, 'auth_token')).toBe(url);
  });

  it('returns url unchanged when there is no query string', () => {
    expect(stripQueryParam('/pty/id/connect', 'auth_token')).toBe('/pty/id/connect');
  });

  it('handles param as the only query key', () => {
    expect(stripQueryParam('/x?auth_token=t', 'auth_token')).toBe('/x');
  });
});
