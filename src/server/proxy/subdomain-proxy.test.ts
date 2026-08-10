import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../router';
import { InstanceRegistry } from '../registry';
import { MAX_PROXY_REQUEST_BODY_BYTES } from '../../shared/types';
import {
  BASE_DOMAIN,
  createHydratedRegistry,
  createMockReq,
  createMockRes,
  instanceHost,
} from '../test-helpers';

describe('subdomain proxy', () => {
  let registry: InstanceRegistry;
  let router: Router;

  beforeEach(() => {
    registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    router = new Router(registry, undefined, BASE_DOMAIN);
  });

  it('returns 404 for unknown subdomain', () => {
    const req = createMockReq('/test', 'GET', instanceHost('unknown'));
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('not found');
  });

  it('returns 503 for offline instance subdomain', () => {
    const req = createMockReq('/', 'GET', instanceHost('vm-offline'));
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('offline');
  });

  it('returns 503 for offline instance sub-path', () => {
    const req = createMockReq('/api/test', 'GET', instanceHost('vm-offline'));
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(503);
  });
});

describe('Subdomain routing', () => {
  let registry: InstanceRegistry;
  let router: Router;

  beforeEach(() => {
    registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    router = new Router(registry, undefined, BASE_DOMAIN);
  });

  describe('online instance proxy', () => {
    it('proxies instance root on subdomain', async () => {
      let captured: Buffer | null = null;
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
          captured = payload;
          return true;
        },
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/', 'GET', instanceHost('vm-online'));
      const res = createMockRes();

      router.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });

      expect(res.statusCode).toBe(0);
      expect(captured).not.toBeNull();
      const requestLine = captured!.toString('utf8').split('\r\n')[0];
      expect(requestLine).toBe('GET / HTTP/1.1');

      router.proxyState.clearAll();
    });

    it('preserves query string when proxying on subdomain', async () => {
      let captured: Buffer | null = null;
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
          captured = payload;
          return true;
        },
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/api/file/list?path=src', 'GET', instanceHost('vm-online'));
      const res = createMockRes();

      router.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });

      expect(captured).not.toBeNull();
      const requestLine = captured!.toString('utf8').split('\r\n')[0];
      expect(requestLine).toBe('GET /api/file/list?path=src HTTP/1.1');

      router.proxyState.clearAll();
    });

    it('proxies /api/instances on instance subdomains instead of serving Gateway API', async () => {
      let captured: Buffer | null = null;
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
          captured = payload;
          return true;
        },
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/api/instances', 'GET', instanceHost('vm-online'));
      const res = createMockRes();

      router.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });

      expect(res.statusCode).toBe(0);
      expect(captured).not.toBeNull();
      const requestLine = captured!.toString('utf8').split('\r\n')[0];
      expect(requestLine).toBe('GET /api/instances HTTP/1.1');

      router.proxyState.clearAll();
    });

    it('sends request_cancel to agent when browser disconnects from proxied request', async () => {
      const controls: any[] = [];
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: () => true,
        sendControlToAgent: (_id: string, msg: any) => {
          controls.push(msg);
        },
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/api/live', 'GET', instanceHost('vm-online'));
      const res = createMockRes();

      router.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });

      expect(res._closeCallbacks.length).toBe(1);
      res._closeCallbacks[0]();

      expect(controls).toEqual([
        expect.objectContaining({ type: 'request_cancel', requestId: expect.any(Number) }),
      ]);

      router.proxyState.clearAll();
    });

    it('ends pending proxy requests when the agent disconnects', async () => {
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: () => true,
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/api/live', 'GET', instanceHost('vm-online'));
      const res = createMockRes();

      router.handleRequest(req, res);
      await new Promise<void>((resolve) => {
        process.nextTick(() => {
          req.emit('end');
          resolve();
        });
      });

      router.cleanupInstanceRequests('vm-online');

      expect(res.statusCode).toBe(502);
      expect(res.body).toBe('Bad Gateway: agent disconnected');

      router.proxyState.clearAll();
    });

    it('rejects proxy requests with oversized content-length', () => {
      const mockWs = {
        readyState: 1,
        OPEN: 1,
        on: () => {},
        close: () => {},
        send: () => {},
      } as any;
      registry.register('vm-online', mockWs, 90_000);

      const mockTunnel = {
        sendToAgent: () => {
          throw new Error('should not proxy oversized request');
        },
      } as any;
      router.setTransport(mockTunnel);

      const req = createMockReq('/api/upload', 'POST', {
        ...instanceHost('vm-online'),
        'content-length': String(MAX_PROXY_REQUEST_BODY_BYTES + 1),
      });
      const res = createMockRes();

      router.handleRequest(req, res);

      expect(res.statusCode).toBe(413);
      expect(res.body).toBe('Payload Too Large');
    });
  });
});

describe('opencodePassword', () => {
  let registry: InstanceRegistry;

  beforeEach(() => {
    registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
  });

  it('registry.update stores opencodePassword via registry API', () => {
    const err = registry.update('vm-online', { opencodePassword: 'my-password' });
    expect(err).toBeNull();
    expect(registry.getOpencodePassword('vm-online')).toBe('my-password');
  });

  it('returns 503 for offline instance (proxy never reached, password not injected)', () => {
    const router = new Router(registry, undefined, BASE_DOMAIN);
    registry.update('vm-offline', { opencodePassword: 'my-password' });

    const req = createMockReq('/', 'GET', instanceHost('vm-offline'));
    const res = createMockRes();

    router.handleRequest(req, res);

    expect(res.statusCode).toBe(503);
    expect(req.headers['authorization']).toBeUndefined();
  });

  it('injects opencodeUser:opencodePassword into proxied Authorization header', async () => {
    const router = new Router(registry, 'secret123', BASE_DOMAIN);
    registry.update('vm-online', { opencodeUser: 'admin', opencodePassword: 'upstream-pass' });

    let captured: Buffer | null = null;
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      on: () => {},
      close: () => {},
      send: () => {},
    } as any;
    registry.register('vm-online', mockWs, 90_000);
    router.setTransport({
      sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
        captured = payload;
        return true;
      },
    } as any);

    const auth = 'Basic ' + Buffer.from('opencode:secret123').toString('base64');
    const req = createMockReq('/api/test', 'GET', {
      ...instanceHost('vm-online'),
      authorization: auth,
    });
    const res = createMockRes();

    router.handleRequest(req, res);
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        req.emit('end');
        resolve();
      });
    });

    expect(captured).not.toBeNull();
    const raw = captured!.toString('utf8');
    const expected = 'Basic ' + Buffer.from('admin:upstream-pass').toString('base64');
    expect(raw.toLowerCase()).toContain(`authorization: ${expected}`.toLowerCase());

    router.proxyState.clearAll();
  });

  it('strips auth_token from the upstream URL while preserving query and upstream credentials', async () => {
    const router = new Router(registry, 'secret123', BASE_DOMAIN);
    registry.update('vm-online', { opencodeUser: 'admin', opencodePassword: 'upstream-pass' });

    let captured: Buffer | null = null;
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      on: () => {},
      close: () => {},
      send: () => {},
    } as any;
    registry.register('vm-online', mockWs, 90_000);
    router.setTransport({
      sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
        captured = payload;
        return true;
      },
    } as any);

    const authToken = Buffer.from('opencode:secret123').toString('base64');
    const req = createMockReq(
      `/api/test?path=src&auth_token=${encodeURIComponent(authToken)}&cursor=0`,
      'GET',
      instanceHost('vm-online'),
    );
    const res = createMockRes();

    router.handleRequest(req, res);
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        req.emit('end');
        resolve();
      });
    });

    expect(captured).not.toBeNull();
    const raw = captured!.toString('utf8');
    const requestLine = raw.split('\r\n')[0];
    const expected = 'Basic ' + Buffer.from('admin:upstream-pass').toString('base64');
    expect(requestLine).toBe('GET /api/test?path=src&cursor=0 HTTP/1.1');
    expect(requestLine).not.toContain('auth_token=');
    expect(raw.toLowerCase()).toContain(`authorization: ${expected}`.toLowerCase());

    router.proxyState.clearAll();
  });

  it('strips Authorization when instance has no opencodePassword', async () => {
    const router = new Router(registry, 'secret123', BASE_DOMAIN);

    let captured: Buffer | null = null;
    const mockWs = {
      readyState: 1,
      OPEN: 1,
      on: () => {},
      close: () => {},
      send: () => {},
    } as any;
    registry.register('vm-online', mockWs, 90_000);
    router.setTransport({
      sendToAgent: (_id: string, _reqId: number, payload: Buffer) => {
        captured = payload;
        return true;
      },
    } as any);

    const auth = 'Basic ' + Buffer.from('opencode:secret123').toString('base64');
    const req = createMockReq('/api/test', 'GET', {
      ...instanceHost('vm-online'),
      authorization: auth,
    });
    const res = createMockRes();

    router.handleRequest(req, res);
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        req.emit('end');
        resolve();
      });
    });

    expect(captured).not.toBeNull();
    const raw = captured!.toString('utf8');
    expect(raw.toLowerCase()).not.toContain('authorization:');

    router.proxyState.clearAll();
  });
});
