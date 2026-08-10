// ---------------------------------------------------------------------------
// Tests: server/router.ts — integration routing + auth + agent data dispatch
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { Router } from './router';
import { DashboardEventBus } from './webui/dashboard-event-bus';
import { toInstanceView } from './api/instance-view';
import { InstanceRegistry } from './registry';
import {
  APEX_HOST,
  BASE_DOMAIN,
  createFakeOidc,
  createHydratedRegistry,
  createMockReq,
  createMockRes,
  createMockSocket,
  instanceHost,
} from './test-helpers';

describe('Router integration', () => {
  let registry: InstanceRegistry;
  let router: Router;

  beforeEach(() => {
    registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    router = new Router(registry, undefined, BASE_DOMAIN);
  });

  describe('unknown routes', () => {
    it('returns 404 for unmapped paths on apex', () => {
      const req = createMockReq('/some/random/path', 'GET', APEX_HOST);
      const res = createMockRes();

      router.handleRequest(req, res as any);

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('Not Found');
    });
  });

  describe('auth (sharedSecret)', () => {
    it('allows all requests when sharedSecret is not configured', () => {
      const routerNoAuth = new Router(registry, undefined, BASE_DOMAIN);
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();
      routerNoAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('allows /health without auth when sharedSecret is set', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/health');
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('returns 302 to /login for / when no auth provided', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('returns 302 to /login for instance subdomain when no auth provided', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', instanceHost('vm-online'));
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('//localhost/login?return=%2F%2Fvm-online.localhost%2F');
    });

    it('allows Dashboard via private LAN IP (auth still required)', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { host: '192.168.1.1' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('requires login via loopback IP when sharedSecret is set', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { host: '127.0.0.1:8080' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('allows apex via private LAN IP in OIDC mode (auth still required)', () => {
      const routerOidc = new Router(registry, undefined, BASE_DOMAIN);
      routerOidc.setOidcClient(createFakeOidc(undefined));
      const req = createMockReq('/', 'GET', { host: '10.0.0.5:8080' });
      const res = createMockRes();
      routerOidc.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
    });

    it('rejects public raw IP hosts', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { host: '8.8.8.8' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(404);
    });

    it('allows Dashboard via localhost when baseDomain mismatches (dev routing)', () => {
      const routerProd = new Router(registry, 'secret123', 'portal.example.com');
      const req = createMockReq('/', 'GET', { host: 'localhost:8080' });
      const res = createMockRes();
      routerProd.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('returns 302 to /login for wrong ?token= param', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/?token=wrong', 'GET', APEX_HOST);
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F%3Ftoken%3Dwrong');
    });

    it('allows instance subdomain with valid Bearer token', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { ...instanceHost('vm-offline'), authorization: 'Bearer secret123' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(503);
    });

    it('allows / with valid ?token= query param', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/?token=secret123', 'GET', APEX_HOST);
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('sets SSO auth cookie with Domain=.baseDomain on Bearer auth', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Bearer secret123' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res._headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringContaining('Domain=.localhost'),
      ]));
    });

    it('returns 302 to /login for wrong Bearer token', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Bearer wrong' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('allows Dashboard via localhost when baseDomain mismatches (dev routing)', () => {
      const routerProd = new Router(registry, 'secret123', 'portal.example.com');
      const req = createMockReq('/', 'GET', { host: 'localhost:8080' });
      const res = createMockRes();
      routerProd.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('returns 401 for Basic auth header with wrong password', () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Basic c2VjcmV0MTIz' });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate'] || res.headers['www-authenticate']).toContain('Basic');
    });

    it('allows instance subdomain with valid Basic auth (password = sharedSecret)', async () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);
      routerWithAuth.setTransport({ sendToAgent: () => true } as any);

      const auth = 'Basic ' + Buffer.from('opencode:secret123').toString('base64');
      const req = createMockReq('/', 'GET', { ...instanceHost('vm-online'), authorization: auth });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });
      expect(res.statusCode).toBe(0);
      routerWithAuth.proxyState.clearAll();
    });

    it('allows instance subdomain with valid auth_token query on WS path', async () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);
      routerWithAuth.setTransport({ sendToAgent: () => true } as any);

      const token = Buffer.from('opencode:secret123').toString('base64');
      const req = createMockReq(
        `/pty/pty_test/connect?auth_token=${encodeURIComponent(token)}`,
        'GET',
        instanceHost('vm-online'),
      );
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });
      expect(res.statusCode).toBe(0);
      routerWithAuth.proxyState.clearAll();
    });

    it('bypasses auth for OPTIONS on instance subdomain (CORS preflight)', async () => {
      const routerWithAuth = new Router(registry, 'secret123', BASE_DOMAIN);
      let captured: Buffer | null = null;
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);
      routerWithAuth.setTransport({
        sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
          captured = payload;
          return true;
        },
      } as any);

      const req = createMockReq('/global/config', 'OPTIONS', {
        ...instanceHost('vm-online'),
        origin: 'tauri://localhost',
      });
      const res = createMockRes();
      routerWithAuth.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });
      expect(res.statusCode).not.toBe(302);
      expect(res.statusCode).not.toBe(401);
      expect(captured).not.toBeNull();
      routerWithAuth.proxyState.clearAll();
    });
  });

  describe('auth (OIDC SSO mode)', () => {
    it('redirects unauthenticated / to /login (OIDC-only)', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('/login?return=%2F');
    });

    it('redirects unauthenticated instance subdomain to /login (OIDC-only)', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/', 'GET', instanceHost('vm-online'));
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(302);
      expect(res.headers['Location'] || res.headers['location']).toBe('//localhost/login?return=%2F%2Fvm-online.localhost%2F');
    });

    it('serves unified login page in OIDC mode with Authentik button and disabled secret field', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/login', 'GET');
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('/auth/login');
      expect(res.body).toContain('OIDC 登录');
      expect(res.body).toContain('disabled');
      expect(res.body).toContain('未启用');
    });

    it('serves unified login page in OIDC+secret mode with enabled secret field', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/login', 'GET');
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('OIDC 登录');
      expect(res.body).not.toContain('placeholder="未启用"');
      expect(res.body).not.toMatch(/<button type="submit" disabled/);
    });

    it('rejects POST /login when sharedSecret is not configured (OIDC-only)', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/login', 'POST', { 'content-type': 'application/x-www-form-urlencoded' });
      const res = createMockRes();
      req.emit('data', Buffer.from('secret=anything'));
      req.emit('end');
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('访问密钥未启用');
    });

    it('allows access with a valid OIDC session', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc({ sub: 'user-1', email: 'me@example.com' }));
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('allows Bearer break-glass even in OIDC mode', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Bearer secret123' });
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('does NOT issue the ocp_auth cookie on Bearer break-glass in OIDC mode', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Bearer secret123' });
      const res = createMockRes();
      r.handleRequest(req, res);
      const setCookie = res._headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
      expect(cookies).not.toContain('ocp_auth=');
    });

    it('GET /auth/login delegates to OidcClient.login', () => {
      const fake = createFakeOidc();
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(fake);
      const req = createMockReq('/auth/login', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(fake.calls.login).toBe(1);
      expect(res.statusCode).toBe(302);
    });

    it('GET /auth/callback delegates to OidcClient.handleCallback', () => {
      const fake = createFakeOidc();
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(fake);
      const req = createMockReq('/auth/callback?code=abc&state=xyz', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(fake.calls.callback).toBe(1);
    });

    it('GET /auth/logout delegates to OidcClient.logout', () => {
      const fake = createFakeOidc({ sub: 'user-1' });
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(fake);
      const req = createMockReq('/auth/logout', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(fake.calls.logout).toBe(1);
    });

    it('dashboard includes logout button when auth is enabled', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/', 'GET', { ...APEX_HOST, authorization: 'Bearer secret123' });
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('/auth/logout');
      expect(res.body).toContain('登出');
    });

    it('dashboard omits logout button when auth is open', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      const req = createMockReq('/', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('href="/auth/logout"');
    });

    it('returns 404 on /auth/login when OIDC is not configured', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/auth/login', 'GET', APEX_HOST);
      const res = createMockRes();
      r.handleRequest(req, res);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('WS upgrade auth', () => {
    it('rejects unauthenticated WS upgrade in OIDC-only mode (regression: not bypassed)', () => {
      const r = new Router(registry, undefined, BASE_DOMAIN);
      r.setOidcClient(createFakeOidc());
      const req = createMockReq('/ws', 'GET', instanceHost('vm-online'));
      const socket = createMockSocket();
      r.handleWsUpgrade(req, socket, Buffer.alloc(0));
      expect(socket.written).toContain('401');
      expect(socket.destroyed).toBe(true);
    });

    it('rejects unauthenticated WS upgrade in sharedSecret mode', () => {
      const r = new Router(registry, 'secret123', BASE_DOMAIN);
      const req = createMockReq('/ws', 'GET', instanceHost('vm-online'));
      const socket = createMockSocket();
      r.handleWsUpgrade(req, socket, Buffer.alloc(0));
      expect(socket.written).toContain('401');
      expect(socket.destroyed).toBe(true);
    });
  });

  describe('handleAgentData', () => {
    const agentReg = createHydratedRegistry([
      { id: 'vm-1', name: 'VM One', tags: [] },
    ]);
    const agentRouter = new Router(agentReg, undefined, BASE_DOMAIN);

    afterEach(() => {
      agentRouter.proxyState.clearAll();
    });

    it('streams SSE responses via write + end on multiple frames', () => {
      const res = createMockRes();
      const writes: Buffer[] = [];
      res.write = (chunk: any) => {
        writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      };

      agentRouter.proxyState.pendingRequests.set(42, res as any);
      agentRouter.proxyState.requestTraces.set(42, 'trace-sse');

      const headerFrame = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n',
      );
      agentRouter.handleAgentData('vm-1', 42, headerFrame);

      expect(res.statusCode).toBe(200);
      expect(res.headersSent).toBe(true);
      expect(res.headers['content-type']).toBe('text/event-stream');

      agentRouter.handleAgentData('vm-1', 42, Buffer.from('data: {"type":"pty.exited"}\n\n'));
      agentRouter.handleAgentData('vm-1', 42, Buffer.alloc(0));

      expect(writes.length).toBe(1);
      expect(writes[0].toString('utf8')).toContain('pty.exited');
      expect(res.body).toBe('');
    });

    it('sends parsed non-SSE response to pending request', () => {
      const res = createMockRes();
      agentRouter.proxyState.pendingRequests.set(99, res as any);

      const frame = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\n\r\n{"ok":true}',
      );
      agentRouter.handleAgentData('vm-1', 99, frame);

      expect(res.statusCode).toBe(200);
      const body = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.body;
      expect(body).toBe('{"ok":true}');
    });

    it('fails and cleans up a pending request when the Agent returns a non-HTTP payload', () => {
      const res = createMockRes();
      agentRouter.proxyState.pendingRequests.set(100, res as any);
      agentRouter.proxyState.requestTraces.set(100, 'trace-invalid-response');
      agentRouter.proxyState.requestTimeouts.set(100, setTimeout(() => {}, 60_000));

      agentRouter.handleAgentData('vm-1', 100, Buffer.from([0x01, 0x02]));

      expect(res.statusCode).toBe(502);
      expect(res.body).toBe('Bad Gateway: invalid agent response');
      expect(agentRouter.proxyState.pendingRequests.has(100)).toBe(false);
      expect(agentRouter.proxyState.requestTraces.has(100)).toBe(false);
      expect(agentRouter.proxyState.requestTimeouts.has(100)).toBe(false);
    });

    it('routes channel-namespace IDs to WS channels, never to HTTP parsing', () => {
      // The ID namespace split (high bit = channel) is the dispatch contract
      // between Gateway and Agent (shared/protocol isChannelRequestId).
      // A channel-ID frame must never be parsed as HTTP even when its payload
      // looks like an HTTP response — doing so would 502 the wrong pending
      // request. The WS channel data path itself is covered by
      // browser-ws-channels.test.ts.
      const res = createMockRes();
      agentRouter.proxyState.pendingRequests.set(777, res as any);
      agentRouter.proxyState.requestTraces.set(777, 'trace-http');

      const httpLookalikeFrame = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html></html>',
      );
      agentRouter.handleAgentData('vm-1', 0x8000_0001, httpLookalikeFrame);

      expect(res.headersSent).toBe(false);
      expect(res.statusCode).toBe(0);
      expect(agentRouter.proxyState.pendingRequests.has(777)).toBe(true);
    });
  });

  describe('dashboard SSE', () => {
    it('/events delegates the response to the injected DashboardEventBus', () => {
      const subscribed: http.ServerResponse[] = [];
      const bus = {
        subscribe: (res: http.ServerResponse) => {
          subscribed.push(res);
        },
      } as unknown as DashboardEventBus;
      router.setDashboardBus(bus);

      const req = createMockReq('/events', 'GET', APEX_HOST);
      const res = createMockRes();
      router.handleRequest(req, res as any);

      expect(subscribed).toHaveLength(1);
      expect(subscribed[0]).toBe(res);
    });

    it('returns 404 for /events when no event bus is wired', () => {
      const req = createMockReq('/events', 'GET', APEX_HOST);
      const res = createMockRes();

      router.handleRequest(req, res as any);

      expect(res.statusCode).toBe(404);
    });

    it('pushes registry snapshots to SSE clients on publish (heartbeat → dashboard chain)', () => {
      // Mirrors the index.ts wiring: the bus provider reads the registry and
      // onInstanceMetricsUpdate/onAgentDisconnect call bus.publish() — a real
      // instance change must reach the connected SSE client's payload.
      const bus = new DashboardEventBus({
        listInstances: () => registry.list().map((i) => toInstanceView(registry, i)),
      });
      router.setDashboardBus(bus);

      const req = createMockReq('/events', 'GET', APEX_HOST);
      const res = createMockRes();
      const writes: string[] = [];
      res.write = (chunk: string) => {
        writes.push(chunk);
        return true;
      };
      res.on = (event: string, cb: Function) => {
        if (event === 'close') res._closeCallbacks.push(cb);
      };
      router.handleRequest(req, res as any);
      expect(res.statusCode).toBe(200);

      // New instance appears → publish() (as index.ts does on heartbeat
      // metrics change) → the open SSE stream carries the fresh snapshot.
      registry.create('vm-live', 'Live VM', []);
      bus.publish();

      expect(writes.some((w) => w.includes('vm-live') && w.includes('"status":"offline"'))).toBe(true);
    });
  });
});
