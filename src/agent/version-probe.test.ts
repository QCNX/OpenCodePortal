// ---------------------------------------------------------------------------
// Tests: agent/version-probe.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { probeOpencodeVersion } from './version-probe';

function startTestServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('probeOpencodeVersion', () => {
  let servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
  });

  it('returns version string from /global/health', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: true, version: '1.18.0' }));
    });
    servers.push(server);

    const version = await probeOpencodeVersion('127.0.0.1', server.port);
    expect(version).toBe('1.18.0');
  });

  it('returns undefined when the server is not reachable', async () => {
    const version = await probeOpencodeVersion('127.0.0.1', 55555);
    expect(version).toBeUndefined();
  });

  it('returns undefined on non-200 response', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });
    servers.push(server);

    const version = await probeOpencodeVersion('127.0.0.1', server.port);
    expect(version).toBeUndefined();
  });

  it('returns undefined on invalid JSON response', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not json');
    });
    servers.push(server);

    const version = await probeOpencodeVersion('127.0.0.1', server.port);
    expect(version).toBeUndefined();
  });

  it('returns undefined when version field is missing', async () => {
    const server = await startTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: true }));
    });
    servers.push(server);

    const version = await probeOpencodeVersion('127.0.0.1', server.port);
    expect(version).toBeUndefined();
  });

  it('requests /global/health path', async () => {
    let requestedPath = '';
    const server = await startTestServer((req, res) => {
      requestedPath = req.url || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: true, version: '1.18.0' }));
    });
    servers.push(server);

    await probeOpencodeVersion('127.0.0.1', server.port);
    expect(requestedPath).toBe('/global/health');
  });

  it('respects custom timeout and resolves quickly on connection refusal', async () => {
    const start = Date.now();
    const version = await probeOpencodeVersion('127.0.0.1', 55555, 200);
    const elapsed = Date.now() - start;
    expect(version).toBeUndefined();
    // Should time out quickly with the custom timeout
    expect(elapsed).toBeLessThan(1000);
  });
});
