import { describe, it, expect } from 'vitest';
import { parseCookies } from './cookies';
import { createMockReq } from '../test-helpers';

describe('parseCookies', () => {
  it('parses a single cookie', () => {
    const req = createMockReq('/', 'GET', { cookie: 'ocp_auth=abc123' });
    const cookies = parseCookies(req);
    expect(cookies).toEqual({ ocp_auth: 'abc123' });
  });

  it('parses multiple cookies', () => {
    const req = createMockReq('/', 'GET', { cookie: 'ocp_auth=abc123; theme=dark' });
    const cookies = parseCookies(req);
    expect(cookies).toEqual({ ocp_auth: 'abc123', theme: 'dark' });
  });

  it('returns empty object when no cookie header', () => {
    const req = createMockReq('/');
    const cookies = parseCookies(req);
    expect(cookies).toEqual({});
  });

  it('handles cookie with spaces', () => {
    const req = createMockReq('/', 'GET', { cookie: '  ocp_auth = abc123 ; path=/ ' });
    const cookies = parseCookies(req);
    expect(cookies['ocp_auth']).toBe('abc123');
  });
});
