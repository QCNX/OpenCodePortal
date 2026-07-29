// ---------------------------------------------------------------------------
// Tests: server/auth/oidc-client.ts — session store + OIDC cookie helpers
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { SessionStore, OidcClient, sanitizeReturnTo } from './oidc-client';

function mockRes(): any {
  const self: any = {
    _headers: {} as Record<string, any>,
    setHeader(name: string, value: any) { self._headers[name.toLowerCase()] = value; },
    getHeader(name: string) { return self._headers[name.toLowerCase()]; },
  };
  return self;
}

function reqWithCookie(cookie: string): http.IncomingMessage {
  const req = new http.IncomingMessage({} as any);
  req.headers = { cookie };
  return req;
}

/** Extract a single Set-Cookie header value for the given cookie name. */
function setCookieFor(res: any, name: string): string | undefined {
  const raw = res._headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.find((c) => c.startsWith(`${name}=`));
}

describe('SessionStore', () => {
  const stores: SessionStore[] = [];
  afterEach(() => { stores.forEach((s) => s.destroy()); stores.length = 0; });

  function newStore(): SessionStore {
    const s = new SessionStore();
    stores.push(s);
    return s;
  }

  it('creates and retrieves a session', () => {
    const store = newStore();
    const id = store.create({ sub: 'user-1', email: 'a@b.c' }, 'access-token');
    const s = store.get(id);
    expect(s).toBeDefined();
    expect(s!.user.sub).toBe('user-1');
    expect(s!.accessToken).toBe('access-token');
  });

  it('returns undefined for unknown session id', () => {
    const store = newStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('deletes a session', () => {
    const store = newStore();
    const id = store.create({ sub: 'user-1' }, 'tok');
    store.delete(id);
    expect(store.get(id)).toBeUndefined();
  });

  it('expires a session past its TTL', () => {
    const store = newStore();
    const id = store.create({ sub: 'user-1' }, 'tok');
    const s = store.get(id)!;
    s.expires = Date.now() - 1; // force-expire
    expect(store.get(id)).toBeUndefined();
  });
});

describe('OidcClient cookie helpers', () => {
  function clientWithDomain(domain: string): any {
    const c = new OidcClient() as any;
    c.cookieDomain = domain;
    return c;
  }

  it('scopes the session cookie to .<baseDomain> for cross-subdomain SSO', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    c.appendCookie(res, c.sessionCookie('sid-123', 86_400_000));
    const cookie = setCookieFor(res, 'ocp_session');
    expect(cookie).toBeDefined();
    expect(cookie).toContain('Domain=.example.com');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('round-trips a signed login transaction cookie', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    const tx = { state: 's1', nonce: 'n1', codeVerifier: 'v1', returnTo: '/', expires: Date.now() + 60_000 };
    c.setTxCookie(res, tx);
    const raw = setCookieFor(res, 'ocp_oidc_tx')!;
    const value = raw.split(';')[0].slice('ocp_oidc_tx='.length);

    const parsed = c.readTxCookie(reqWithCookie(`ocp_oidc_tx=${value}`));
    expect(parsed).toBeDefined();
    expect(parsed.state).toBe('s1');
    expect(parsed.nonce).toBe('n1');
    expect(parsed.codeVerifier).toBe('v1');
  });

  it('rejects a tampered transaction cookie', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    const tx = { state: 's1', nonce: 'n1', codeVerifier: 'v1', returnTo: '/', expires: Date.now() + 60_000 };
    c.setTxCookie(res, tx);
    const raw = setCookieFor(res, 'ocp_oidc_tx')!;
    const value = raw.split(';')[0].slice('ocp_oidc_tx='.length);
    const tampered = value.slice(0, -2) + (value.endsWith('AA') ? 'BB' : 'AA');

    expect(c.readTxCookie(reqWithCookie(`ocp_oidc_tx=${tampered}`))).toBeUndefined();
  });

  it('rejects an expired transaction cookie', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    const tx = { state: 's1', nonce: 'n1', codeVerifier: 'v1', returnTo: '/', expires: Date.now() - 1 };
    c.setTxCookie(res, tx);
    const raw = setCookieFor(res, 'ocp_oidc_tx')!;
    const value = raw.split(';')[0].slice('ocp_oidc_tx='.length);

    expect(c.readTxCookie(reqWithCookie(`ocp_oidc_tx=${value}`))).toBeUndefined();
  });

  it('sanitizes the post-login returnTo to same-origin relative paths', () => {
    expect(sanitizeReturnTo('/dashboard', 'example.com')).toBe('/dashboard');
    expect(sanitizeReturnTo('//evil.com', 'example.com')).toBe('/');
    expect(sanitizeReturnTo('https://evil.com', 'example.com')).toBe('/');
    expect(sanitizeReturnTo('', 'example.com')).toBe('/');
  });

  it('accepts scheme-relative subdomain URLs and rejects external hosts', () => {
    // Valid: subdomain of baseDomain
    expect(sanitizeReturnTo('//dev.example.com/workspace/project', 'example.com')).toBe('//dev.example.com/workspace/project');
    // Valid: apex itself
    expect(sanitizeReturnTo('//example.com/dashboard', 'example.com')).toBe('//example.com/dashboard');
    // Valid: deep subdomain
    expect(sanitizeReturnTo('//a.b.example.com/path', 'example.com')).toBe('//a.b.example.com/path');
    // Reject: different domain
    expect(sanitizeReturnTo('//evil.com/path', 'example.com')).toBe('/');
    // Reject: similar but not same (example.com.evil.com)
    expect(sanitizeReturnTo('//example.com.evil.com/path', 'example.com')).toBe('/');
    // Reject: absolute https URL
    expect(sanitizeReturnTo('https://dev.example.com/path', 'example.com')).toBe('/');
    // Reject: no host (just //)
    expect(sanitizeReturnTo('//', 'example.com')).toBe('/');
    // Valid: with query string
    expect(sanitizeReturnTo('//dev.example.com/workspace?a=1&b=2', 'example.com')).toBe('//dev.example.com/workspace?a=1&b=2');
    // Valid: port is stripped during validation (dev scenarios)
    expect(sanitizeReturnTo('//dev.example.com:8080/workspace', 'example.com')).toBe('//dev.example.com:8080/workspace');
  });

  it('logout clears the session cookie and redirects to /login', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    let redirect = '';
    res.writeHead = (_code: number, headers?: any) => {
      redirect = headers?.Location ?? headers?.location ?? '';
      return res;
    };
    res.end = () => res;
    const req = reqWithCookie('ocp_session=whatever');
    c.logout(req, res);
    const cookie = setCookieFor(res, 'ocp_session');
    expect(cookie).toContain('Domain=.example.com');
    expect(cookie).toContain('Max-Age=0');
    expect(redirect).toBe('/login');
  });

  it('session cookie includes Secure when requested', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    c.appendCookie(res, c.sessionCookie('sid-123', 86_400_000, undefined, true));
    const cookie = setCookieFor(res, 'ocp_session');
    expect(cookie).toBeDefined();
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('session cookie omits Secure when not requested', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    c.appendCookie(res, c.sessionCookie('sid-123', 86_400_000));
    const cookie = setCookieFor(res, 'ocp_session');
    expect(cookie).toBeDefined();
    expect(cookie).not.toContain('Secure');
  });

  it('tx cookie includes Secure when requested', () => {
    const c = clientWithDomain('example.com');
    const res = mockRes();
    const tx = { state: 's1', nonce: 'n1', codeVerifier: 'v1', returnTo: '/', expires: Date.now() + 60_000 };
    c.setTxCookie(res, tx, undefined, true);
    const raw = setCookieFor(res, 'ocp_oidc_tx')!;
    expect(raw).toContain('Secure');
  });
});
