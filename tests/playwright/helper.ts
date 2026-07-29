// ---------------------------------------------------------------------------
// Playwright test helper — starts Gateway + Agent + Echo server
// ---------------------------------------------------------------------------
import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestEnv {
  gatewayUrl: string;
  instanceUrl: string;
  baseDomain: string;
  secret: string;
  instanceId: string;
  instanceName: string;
  cleanup: () => void;
}

/** Generate temp YAML config files and start Gateway + Agent + Echo server. */
export async function setupEnv(): Promise<TestEnv> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ocp-playwright-'));
  const secret = 'pw-test-secret';
  const instanceId = 'pw-vm';
  const instanceName = 'PW Test VM';
  const baseDomain = 'localhost';

  // Assign free ports
  const { port: echoPort } = await allocatePort();
  const { port: gwPort } = await allocatePort();

  // -- Echo server (mock OpenCode) --
  const echoScript = [
    `const http = require('node:http');`,
    `const { WebSocketServer } = require('ws');`,
    ``,
    `const server = http.createServer((req, res) => {`,
    `  const pathOnly = (req.url || '/').split('?')[0];`,
    `  if (pathOnly === '/html') {`,
    `    res.writeHead(200, { 'Content-Type': 'text/html' });`,
    `    res.end('<html lang="zh"><head><title>E2E</title><style>:root{--font-family-sans:ui-sans-serif,system-ui,sans-serif;--font-size-small:12px;--button-secondary-base:#f9f9f9;--text-strong:#111;--surface-raised-stronger-non-alpha:#fff;--surface-raised-base-hover:rgba(0,0,0,0.06);--border-weak-base:rgba(0,0,0,0.12);--shadow-md:0 4px 12px rgba(0,0,0,0.12);--radius-md:8px;}</style></head><body><h1>Hello E2E</h1><div class="flex items-center min-w-0 pr-2"><div id="opencode-titlebar-left" class="flex items-center gap-1 shrink-0 min-w-[24px] min-h-[24px]"></div><div class="flex-1"></div><div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end min-w-[24px] min-h-[24px]"></div></div></body></html>');`,
    `    return;`,
    `  }`,
    `  if (req.url === '/global/event') {`,
    `    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });`,
    `    res.write('data: {"type":"server.connected"}\\n\\n');`,
    `    const timer = setInterval(() => res.write('data: {"type":"ping"}\\n\\n'), 200);`,
    `    req.on('close', () => clearInterval(timer));`,
    `    return;`,
    `  }`,
    `  const chunks = [];`,
    `  req.on('data', c => chunks.push(c));`,
    `  req.on('end', () => {`,
    `    const body = Buffer.concat(chunks);`,
    `    res.writeHead(200, { 'Content-Type': 'application/json' });`,
    `    res.end(JSON.stringify({ ok: true, method: req.method, path: req.url, body_len: body.length }));`,
    `  });`,
    `});`,
    ``,
    `const wss = new WebSocketServer({ server });`,
    `wss.on('connection', (ws) => {`,
    `  ws.on('message', (data) => {`,
    `    ws.send('echo:' + (Buffer.isBuffer(data) ? data.toString() : data));`,
    `  });`,
    `});`,
    ``,
    `server.listen(${echoPort}, '127.0.0.1', () => {});`,
    ``,
  ].join('\n');
  writeFileSync(join(tmpDir, 'echo-server.cjs'), echoScript);
  const echoProc = spawn('node', [join(tmpDir, 'echo-server.cjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
  });

  // Wait for echo server — check stderr for errors
  let echoUp = false;
  const echoStderr: string[] = [];
  echoProc.stderr?.on('data', (d: Buffer) => echoStderr.push(d.toString()));
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const resp = await fetch(`http://127.0.0.1:${echoPort}/`);
      if (resp.ok) { echoUp = true; break; }
    } catch {}
  }
  if (!echoUp) {
    killAll([echoProc], tmpDir);
    throw new Error(`Echo server failed to start on :${echoPort}: ${echoStderr.join('')}`);
  }

  // -- Gateway config (YAML) --
  const gwYaml = `
gateway:
  port: ${gwPort}
  host: 127.0.0.1
  baseDomain: ${baseDomain}
  sharedSecret: ${secret}
`.trim();
  const gwConfigPath = join(tmpDir, 'gateway.yaml');
  writeFileSync(gwConfigPath, gwYaml);

  // Start Gateway
  const gwProc = spawn('node', ['dist/server/index.js', gwConfigPath], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORTAL_DATA_DIR: join(tmpDir, 'gw-data'), LOG_LEVEL: 'warn' },
  });

  // Wait for Gateway
  let gwUp = false;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const resp = await fetch(`http://127.0.0.1:${gwPort}/health`);
      if (resp.ok) { gwUp = true; break; }
    } catch {}
  }
  if (!gwUp) {
    killAll([gwProc, echoProc], tmpDir);
    throw new Error('Gateway failed to start');
  }

  // Create instance via API
  const createResp = await fetch(`http://127.0.0.1:${gwPort}/api/instances`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: instanceId, name: instanceName, tags: ['playwright'] }),
  });
  if (createResp.status !== 201) {
    killAll([gwProc, echoProc], tmpDir);
    throw new Error(`Failed to create instance: ${createResp.status} ${await createResp.text()}`);
  }
  const created = await createResp.json();
  const assignedToken = created.assignedToken as string;

  // -- Agent config (YAML) --
  const agentYaml = `
gateway:
  url: ws://127.0.0.1:${gwPort}/agent/connect
registrationToken: ${assignedToken}
targetHost: 127.0.0.1
targetPort: ${echoPort}
reconnect:
  baseDelayMs: 1000
  maxDelayMs: 30000
heartbeat:
  intervalMs: 30000
`.trim();
  const agentConfigPath = join(tmpDir, 'agent.yaml');
  writeFileSync(agentConfigPath, agentYaml);

  // Start Agent
  const agentProc = spawn('node', ['dist/agent/index.js', agentConfigPath], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORTAL_DATA_DIR: join(tmpDir, 'agent-data'), LOG_LEVEL: 'warn' },
  });

  const gatewayUrl = `http://${baseDomain}:${gwPort}`;
  const instanceUrl = `http://${instanceId}.${baseDomain}:${gwPort}`;

  // Wait for Agent registration via health check
  let registered = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const resp = await fetch(`${gatewayUrl}/health`);
      const body = await resp.json();
      if (body.online > 0) { registered = true; break; }
    } catch {}
  }
  if (!registered) {
    killAll([gwProc, agentProc, echoProc], tmpDir);
    throw new Error('Agent failed to register within 7.5s');
  }

  const cleanup = () => killAll([gwProc, agentProc, echoProc], tmpDir);
  return {
    gatewayUrl,
    instanceUrl,
    baseDomain,
    secret,
    instanceId,
    instanceName,
    cleanup,
  };
}

function killAll(procs: ChildProcess[], tmpDir: string): void {
  for (const proc of procs) proc.kill('SIGKILL');
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

/** Allocate a free port by binding briefly. */
async function allocatePort(): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve({ port }));
    });
    srv.on('error', reject);
  });
}
