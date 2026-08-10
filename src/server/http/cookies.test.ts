import { describe, it, expect } from 'vitest';
import { parseCookies, appendSetCookie, isSecureRequest } from './cookies';
import { createMockReq, createMockRes } from '../test-helpers';

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

describe('appendSetCookie', () => {
  it('sets a single cookie header', () => {
    const res = createMockRes();
    appendSetCookie(res, 'ocp_session=abc; Path=/');
    const raw = res.getHeader('Set-Cookie');
    expect(Array.isArray(raw) ? raw : [raw]).toEqual(['ocp_session=abc; Path=/']);
  });

  it('appends to existing Set-Cookie headers', () => {
    const res = createMockRes();
    appendSetCookie(res, 'a=1');
    appendSetCookie(res, 'b=2');
    const raw = res.getHeader('Set-Cookie');
    expect(Array.isArray(raw) ? raw : [raw]).toEqual(['a=1', 'b=2']);
  });
});

describe('isSecureRequest', () => {
  it('returns true when X-Forwarded-Proto is https', () => {
    const req = createMockReq('/', 'GET', { 'x-forwarded-proto': 'https' });
    expect(isSecureRequest(req)).toBe(true);
  });

  it('returns false for http, missing header, or non-string value', () => {
    expect(isSecureRequest(createMockReq('/', 'GET', { 'x-forwarded-proto': 'http' }))).toBe(false);
    expect(isSecureRequest(createMockReq('/'))).toBe(false);
    expect(isSecureRequest(createMockReq('/', 'GET', { 'x-forwarded-proto': ['https'] }))).toBe(false);
  });
});
