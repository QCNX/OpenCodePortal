import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstanceRegistry } from '../registry';
import { BrowserWsChannels } from './browser-ws-channels';
import { MemoryStateStore } from '../../shared/state';
import { AuthGate } from '../auth/gate';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_DOMAIN = 'localhost';
const SECRET = 'secret123';
const BEARER = `Bearer ${SECRET}`;

function mockDuplex(): any {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
    writable: true,
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
  };
}

function mockRequest(url: string, headers: Record<string, string> = {}): http.IncomingMessage {
  const req = new http.IncomingMessage({} as any);
  req.url = url;
  req.headers = headers;
  return req;
}

/** Create a hydrated registry with given instance defs. */
function createRegistry(defs: { id: string; name: string; tags: string[] }[]): InstanceRegistry {
  const registry = new InstanceRegistry();
  const store = new MemoryStateStore();
  registry.hydrate(store);
  for (const def of defs) {
    registry.create(def.id, def.name, def.tags);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Mock ws module so handleUpgrade calls the callback immediately
// ---------------------------------------------------------------------------

vi.mock('ws', () => {
  const mockSend = vi.fn();
  const mockClose = vi.fn();

  class MockWebSocket {
    readyState = 1;
    send = mockSend;
    close = mockClose;
    static OPEN = 1;
    on(_event: string, _cb: Function) {}
  }

  class MockWebSocketServer {
    constructor(_opts?: any) {}
    handleUpgrade(_req: any, _socket: any, _head: any, cb: Function) {
      cb(new MockWebSocket());
    }
  }

  return {
    default: MockWebSocket,
    WebSocketServer: MockWebSocketServer,
  };
});

// ---------------------------------------------------------------------------
// Tests — auth is disabled so channel_open content can be tested directly
// ---------------------------------------------------------------------------

describe('BrowserWsChannels WS upgrade (auth disabled)', () => {
  let registry: InstanceRegistry;
  let channels: BrowserWsChannels;
  let mockTunnel: { sendControlToAgent: ReturnType<typeof vi.fn>; sendToAgent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    registry = createRegistry([
      { id: 'vm-auth', name: 'Auth VM', tags: ['dev'] },
      { id: 'vm-noauth', name: 'No Auth VM', tags: ['dev'] },
    ]);
    registry.update('vm-auth', { opencodeUser: 'admin', opencodePassword: 'upstream-pass' });

    const mockAgentWs = { readyState: 1, OPEN: 1, on: vi.fn(), close: vi.fn(), send: vi.fn() } as any;
    registry.register('vm-auth', mockAgentWs, 90_000, vi.fn());
    registry.register('vm-noauth', mockAgentWs, 90_000, vi.fn());

    mockTunnel = {
      sendControlToAgent: vi.fn(),
      sendToAgent: vi.fn(),
    };

    channels = new BrowserWsChannels({
      registry,
      baseDomain: BASE_DOMAIN,
      getTransport: () => mockTunnel as any,
      authGate: new AuthGate(undefined, BASE_DOMAIN), // auth disabled
    });
  });

  it('strips auth_token from WS channel_open path', () => {
    const req = mockRequest(
      '/ws/terminal?auth_token=Zm9vOmJhcg&cursor=0',
      { host: `vm-auth.${BASE_DOMAIN}` },
    );
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(mockTunnel.sendControlToAgent).toHaveBeenCalledTimes(1);
    const msg = mockTunnel.sendControlToAgent.mock.calls[0][1];
    expect(msg.type).toBe('channel_open');
    expect(msg.path).toBe('/ws/terminal?cursor=0');
    expect(msg.path).not.toContain('auth_token');
  });

  it('injects Basic authorization into channel_open headers when opencodePassword is set', () => {
    const req = mockRequest('/pty/test', { host: `vm-auth.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(mockTunnel.sendControlToAgent).toHaveBeenCalledTimes(1);
    const msg = mockTunnel.sendControlToAgent.mock.calls[0][1];
    expect(msg.type).toBe('channel_open');
    expect(msg.headers).toBeDefined();
    const expectedB64 = Buffer.from('admin:upstream-pass').toString('base64');
    expect(msg.headers.authorization).toBe(`Basic ${expectedB64}`);
  });

  it('omits Authorization from channel_open headers when no opencodePassword', () => {
    const req = mockRequest('/pty/test', { host: `vm-noauth.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(mockTunnel.sendControlToAgent).toHaveBeenCalledTimes(1);
    const msg = mockTunnel.sendControlToAgent.mock.calls[0][1];
    expect(msg.type).toBe('channel_open');
    expect(msg.headers).toBeDefined();
    expect(msg.headers.authorization).toBeUndefined();
  });

  it('preserves other query params while stripping auth_token', () => {
    const req = mockRequest(
      '/ws?keep=yes&auth_token=abc123&another=val',
      { host: `vm-auth.${BASE_DOMAIN}` },
    );
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(mockTunnel.sendControlToAgent).toHaveBeenCalledTimes(1);
    const msg = mockTunnel.sendControlToAgent.mock.calls[0][1];
    expect(msg.type).toBe('channel_open');
    expect(msg.path).toContain('keep=yes');
    expect(msg.path).toContain('another=val');
    expect(msg.path).not.toContain('auth_token');
  });

  it('passes channel_open with correct instanceId', () => {
    const req = mockRequest('/test', { host: `vm-auth.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(mockTunnel.sendControlToAgent).toHaveBeenCalledTimes(1);
    const [instanceId] = mockTunnel.sendControlToAgent.mock.calls[0];
    expect(instanceId).toBe('vm-auth');
  });

  it('returns 404 for unknown subdomain', () => {
    const req = mockRequest('/test', { host: `unknown.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404'));
  });

  it('returns 503 for offline instance', () => {
    const offlineRegistry = createRegistry([
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    const offlineChannels = new BrowserWsChannels({
      registry: offlineRegistry,
      baseDomain: BASE_DOMAIN,
      getTransport: () => mockTunnel as any,
      authGate: new AuthGate(undefined, BASE_DOMAIN),
    });

    const req = mockRequest('/test', { host: `vm-offline.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    offlineChannels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('503'));
  });
});

// ---------------------------------------------------------------------------
// Tests — auth is enabled to verify WS upgrade rejection
// ---------------------------------------------------------------------------

describe('BrowserWsChannels WS upgrade (auth enabled)', () => {
  it('rejects WS upgrade with 401 when unauthenticated', () => {
    const registry = createRegistry([
      { id: 'vm-auth', name: 'Auth VM', tags: ['dev'] },
    ]);
    const mockAgentWs = { readyState: 1, OPEN: 1, on: vi.fn(), close: vi.fn(), send: vi.fn() } as any;
    registry.register('vm-auth', mockAgentWs, 90_000, vi.fn());

    const mockTunnel = { sendControlToAgent: vi.fn(), sendToAgent: vi.fn() };
    const channels = new BrowserWsChannels({
      registry,
      baseDomain: BASE_DOMAIN,
      getTransport: () => mockTunnel as any,
      authGate: new AuthGate(SECRET, BASE_DOMAIN),
    });

    const req = mockRequest('/test', { host: `vm-auth.${BASE_DOMAIN}` });
    const socket = mockDuplex();

    channels.handleWsUpgrade(req, socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401'));
  });
});
