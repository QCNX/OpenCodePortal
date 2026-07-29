import { describe, it, expect } from 'vitest';
import { AuthGate } from './gate';
import { createMockReq, createMockRes } from '../test-helpers';

const SECRET = 'secret123';

function basicHeader(user: string, password: string): string {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

function authTokenQuery(user: string, password: string): string {
  const token = Buffer.from(`${user}:${password}`).toString('base64');
  return `/pty/pty_test/connect?auth_token=${encodeURIComponent(token)}`;
}

describe('AuthGate Basic auth (sharedSecret carrier)', () => {
  it('accepts Authorization: Basic when password matches sharedSecret', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('opencode', SECRET) });
    expect(gate.checkBasicAuth(req)).toBe(true);
    expect(gate.isAuthenticated(req)).toBe(true);
  });

  it('accepts ?auth_token= query when password matches sharedSecret', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq(authTokenQuery('any', SECRET), 'GET');
    expect(gate.checkBasicAuth(req)).toBe(true);
    expect(gate.isAuthenticated(req)).toBe(true);
  });

  it('rejects wrong password', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('opencode', 'wrong') });
    expect(gate.checkBasicAuth(req)).toBe(false);
    expect(gate.isAuthenticated(req)).toBe(false);
  });

  it('rejects malformed base64', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: 'Basic !!!not-base64!!!' });
    expect(gate.checkBasicAuth(req)).toBe(false);
  });

  it('rejects credential without colon separator', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const b64 = Buffer.from('nocolon').toString('base64');
    const req = createMockReq('/', 'GET', { authorization: `Basic ${b64}` });
    expect(gate.checkBasicAuth(req)).toBe(false);
  });

  it('ignores username (any user with correct password passes)', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('whispercode', SECRET) });
    expect(gate.checkBasicAuth(req)).toBe(true);
  });

  it('returns false when sharedSecret is not configured', () => {
    const gate = new AuthGate(undefined, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('opencode', SECRET) });
    expect(gate.checkBasicAuth(req)).toBe(false);
  });

  it('rejects password with different length (timingSafeEqualStr length guard)', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('opencode', 'short') });
    expect(gate.checkBasicAuth(req)).toBe(false);
  });

  it('respondIfUnauthenticated returns 401 for invalid Basic credentials', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/', 'GET', { authorization: basicHeader('opencode', 'wrong') });
    const res = createMockRes();
    const sent = gate.respondIfUnauthenticated(req, res, { isSubdomain: true });
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate'] || res.headers['www-authenticate']).toContain('Basic');
  });

  it('respondIfUnauthenticated bypasses OPTIONS preflight', () => {
    const gate = new AuthGate(SECRET, 'localhost');
    const req = createMockReq('/global/config', 'OPTIONS', { origin: 'tauri://localhost' });
    const res = createMockRes();
    const sent = gate.respondIfUnauthenticated(req, res, { isSubdomain: true });
    expect(sent).toBe(false);
    expect(res.statusCode).toBe(0);
  });

  it('redirects unauthenticated subdomain request to apex login with return URL', () => {
    const gate = new AuthGate(SECRET, 'example.com');
    const req = createMockReq('/workspace/project?a=1', 'GET', { host: 'dev.example.com' });
    const res = createMockRes();
    const sent = gate.respondIfUnauthenticated(req, res, {
      isSubdomain: true,
      method: 'GET',
      url: '/workspace/project?a=1',
    });
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(302);
    expect(res.headers['Location'] || res.headers['location']).toBe(
      '//example.com/login?return=' + encodeURIComponent('//dev.example.com/workspace/project?a=1'),
    );
  });

  it('redirects unauthenticated apex request to /login with return URL', () => {
    const gate = new AuthGate(SECRET, 'example.com');
    const req = createMockReq('/dashboard', 'GET', { host: 'example.com' });
    const res = createMockRes();
    const sent = gate.respondIfUnauthenticated(req, res, {
      isSubdomain: false,
      method: 'GET',
      url: '/dashboard',
    });
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(302);
    expect(res.headers['Location'] || res.headers['location']).toBe(
      '/login?return=' + encodeURIComponent('/dashboard'),
    );
  });

  describe('verifySharedSecret', () => {
    it('accepts matching secret', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      expect(gate.verifySharedSecret('secret123')).toBe(true);
    });

    it('rejects non-matching secret', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      expect(gate.verifySharedSecret('wrong')).toBe(false);
    });

    it('rejects empty candidate', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      expect(gate.verifySharedSecret('')).toBe(false);
    });

    it('rejects when sharedSecret is not configured', () => {
      const gate = new AuthGate(undefined, 'localhost');
      expect(gate.verifySharedSecret('anything')).toBe(false);
    });
  });

  describe('Secure cookie flag', () => {
    it('omits Secure when not requested', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      const res = createMockRes();
      gate.setAuthCookie(res, 'localhost', false);
      const cookies = res.getHeader('Set-Cookie');
      const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(cookie).not.toContain('Secure');
    });

    it('includes Secure when requested', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      const res = createMockRes();
      gate.setAuthCookie(res, 'localhost', true);
      const cookies = res.getHeader('Set-Cookie');
      const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(cookie).toContain('Secure');
    });

    it('clearCookies includes Secure when requested', () => {
      const gate = new AuthGate(SECRET, 'localhost');
      const res = createMockRes();
      gate.clearCookies(res, 'localhost', true);
      const cookies = res.getHeader('Set-Cookie');
      const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Max-Age=0');
    });
  });
});
