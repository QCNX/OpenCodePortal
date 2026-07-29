import { describe, it, expect, beforeEach } from 'vitest';
import { formatPortalVersionLabel, getPortalVersion } from '../../shared/version';
import { Router } from '../router';
import { InstanceRegistry } from '../registry';
import {
  APEX_HOST,
  BASE_DOMAIN,
  createHydratedRegistry,
  createMockReq,
  createMockRes,
} from '../test-helpers';

describe('Login page', () => {
  let registry: InstanceRegistry;

  beforeEach(() => {
    registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
    ]);
  });

  describe('GET /login', () => {
    it('returns login form HTML when sharedSecret is configured', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/login');
      const res = createMockRes();

      routerWithAuth.handleRequest(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('OpenCode Portal');
      expect(res.body).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(res.body).toContain('form');
      expect(res.body).toContain('method="POST"');
      expect(res.body).toContain('portal-version portal-version--footer');
      expect(res.body).toContain(formatPortalVersionLabel(getPortalVersion()));
      expect(res.body).toContain('data-portal-icon="system"');
      expect(res.body).toContain('data-portal-icon="language"');
    });

    it('is accessible even with sharedSecret (public route)', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/login');
      const res = createMockRes();

      routerWithAuth.handleRequest(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('renders Traditional Chinese from the shared language cookie', () => {
      const routerWithAuth = new Router(registry, 'secret123', 'portal.example.com');
      const req = createMockReq('/login', 'GET', {
        host: 'portal.example.com',
        cookie: 'language=zht',
      });
      const res = createMockRes();

      routerWithAuth.handleRequest(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<html lang="zh-TW">');
      expect(res.body).toContain('登入以繼續');
      expect(res.body).toContain('繁體中文');
      expect(res.body).toContain("';Domain=.'+base");
      expect(res.body).toContain('/^\\d{1,3}');
    });
  });

  describe('POST /login', () => {
    it('redirects to / on correct secret and sets host-only cookie when baseDomain mismatches', async () => {
      const routerWithAuth = new Router(registry, 'secret123', 'portal.example.com');
      const req = createMockReq('/login', 'POST', {
        host: '127.0.0.1:8080',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '12',
      });
      const res = createMockRes();

      const done = new Promise<void>((resolve) => {
        routerWithAuth.handleRequest(req, res as any);
        setTimeout(resolve, 10);
      });
      req.emit('data', Buffer.from('secret=secret123'));
      req.emit('end');
      await done;

      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/');
      const setCookie = res.getHeader('set-cookie');
      const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
      expect(cookie).toContain('ocp_auth=');
      expect(cookie).not.toContain('Domain=');

      const authedReq = createMockReq('/', 'GET', {
        host: '127.0.0.1:8080',
        cookie: cookie.split(';')[0],
      });
      const authedRes = createMockRes();
      routerWithAuth.handleRequest(authedReq, authedRes as any);
      expect(authedRes.statusCode).toBe(200);
      expect(authedRes.body).toContain('OpenCode Portal');
    });
  });

  describe('GET / with sharedSecret → login', () => {
    it('redirects to /login when sharedSecret is set and no auth present', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();

      routerWithAuth.handleRequest(req, res);

      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });
  });
});
