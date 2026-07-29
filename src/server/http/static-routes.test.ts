import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../router';
import {
  BASE_DOMAIN,
  createHydratedRegistry,
  createMockReq,
  createMockRes,
} from '../test-helpers';

describe('static routes', () => {
  let router: Router;

  beforeEach(() => {
    const registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    router = new Router(registry, undefined, BASE_DOMAIN);
  });

  describe('health endpoint', () => {
    it('returns 200 with status JSON', () => {
      const req = createMockReq('/health');
      const res = createMockRes();

      router.handleRequest(req, res as any);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(res.body)).toEqual({ status: 'ok', instances: 2, online: 0, uptime: expect.any(Number) });
    });
  });

  describe('portal CSS', () => {
    it('returns 200 with CSS content type', () => {
      const req = createMockReq('/portal.css');
      const res = createMockRes();
      router.handleRequest(req, res as any);
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/css; charset=utf-8');
      expect(res.body).toContain('--font-family-sans');
      expect(res.body).toContain('--surface-base');
      expect(res.body).toContain('.portal-status-refresh');
      expect(res.body).toContain('.portal-svg-icon');
      expect(res.body).toContain('.portal-row-action-danger:hover');
      expect(res.body).toContain('.deploy-method-tabs .portal-tab');
      expect(res.body).toContain('flex: 1 1 50%;');
      expect(res.body).toContain('.deploy-upgrade-guide');
      expect(res.body).toContain('color: var(--text-weak);');
      expect(res.body).toContain('[data-component="button-v2"][data-variant="ghost-muted"]');
      expect(res.body).toContain('[data-component="button-v2"][data-tone="critical"]');
      expect(res.body).toContain('.portal-button-row');
      expect(res.body).not.toContain('[data-component="button-v2"][data-variant="secondary"]');
      expect(res.body).not.toContain('[data-component="button-v2"][data-variant="danger"]');
      expect(res.body).toMatch(/\.portal-status-refresh:hover\s*\{\s*background: transparent;/);
    });

    it('is public — serves without auth even when sharedSecret is set', () => {
      const registry = createHydratedRegistry([]);
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/portal.css');
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res as any);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('--text-stronger');
    });

    it('sets long cache headers', () => {
      const req = createMockReq('/portal.css');
      const res = createMockRes();
      router.handleRequest(req, res as any);
      expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
    });
  });

  describe('portal favicon', () => {
    it('returns 200 with SVG image content type', () => {
      const req = createMockReq('/favicon.svg');
      const res = createMockRes();
      router.handleRequest(req, res as any);
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8');
      expect(res.body).toContain('<svg');
      expect(res.body).toContain('OpenCode Portal');
    });

    it('redirects /favicon.ico to /favicon.svg', () => {
      const registry = createHydratedRegistry([]);
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/favicon.ico');
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res as any);
      expect(res.statusCode).toBe(302);
      expect(res.headers.Location).toBe('/favicon.svg');
      expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
    });
  });
});
