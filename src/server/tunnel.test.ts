import * as http from 'http';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { TunnelServer } from './tunnel';
import { createHydratedRegistry } from './test-helpers';

describe('TunnelServer', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('terminates a registered agent after its heartbeat expires', async () => {
    const registry = createHydratedRegistry([{ id: 'vm-1', name: 'VM One', tags: [] }]);
    let disconnects = 0;
    let resolveDisconnect!: () => void;
    const disconnected = new Promise<void>((resolve) => { resolveDisconnect = resolve; });
    const tunnel = new TunnelServer(registry, {
      onAgentData: () => {},
      onAgentChannelEvent: () => {},
      onAgentDisconnect: () => {
        disconnects++;
        resolveDisconnect();
      },
    }, 'gateway-1', 20);
    const server = http.createServer();
    servers.push(server);
    tunnel.attach(server);
    server.on('upgrade', (req, socket, head) => tunnel.handleWsUpgrade(req, socket, head));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const token = registry.getAssignedToken('vm-1')!;
    const agent = new WebSocket(`ws://127.0.0.1:${port}/agent/connect`);

    await new Promise<void>((resolve, reject) => {
      agent.once('open', () => agent.send(JSON.stringify({ type: 'register', token })));
      agent.once('message', () => resolve());
      agent.once('error', reject);
    });
    await new Promise<void>((resolve) => agent.once('close', () => resolve()));
    await disconnected;

    expect(disconnects).toBe(1);
    expect(registry.get('vm-1')?.status).toBe('offline');
  });
});
