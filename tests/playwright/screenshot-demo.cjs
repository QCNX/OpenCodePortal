// ---------------------------------------------------------------------------
// Demo screenshot script — starts Gateway + 1 mock OpenCode echo server +
// 2 Agents (2 online instances) plus 2 offline instances, then captures
// screenshots of the Dashboard, deploy / setup-guide / add / edit / detail
// modals, the login page and a proxied instance page.
//
// The mock OpenCode page is a hand-crafted replica of the OpenCode 1.18.10
// web UI (V2 layout): titlebar with #opencode-titlebar-right mount point,
// giant "opencode" watermark, composer with model picker, status bar and
// the providers banner — so the injected OC Portal nav button and its
// dropdown render exactly as they would on a real instance page.
//
// Usage: node tests/playwright/screenshot-demo.cjs [outputDir]
// Output defaults to ~/workspace/tmp/
// ---------------------------------------------------------------------------
const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { writeFileSync, mkdtempSync, rmSync, mkdirSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir, homedir } = require('node:os');
const { join, resolve } = require('node:path');

const SECRET = 'ocp-demo-secret';
const BASE_DOMAIN = 'localhost';
const OPENCODE_VERSION = '1.18.10';

// ---------------------------------------------------------------------------
// Mock OpenCode server — serves a replica of the OpenCode 1.18.10 web UI
// ---------------------------------------------------------------------------
function echoServerScript(port) {
  return `const http = require('node:http');
const { WebSocketServer } = require('ws');

const PAGE = String.raw\`<!DOCTYPE html>
<html lang="en" data-theme="oc-2" data-color-scheme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCode</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    /* OpenCode V2 design tokens */
    --v2-background-bg-deep: #fafafa;
    --v2-background-bg-layer-01: #ffffff;
    --v2-background-bg-layer-02: #f4f4f5;
    --v2-background-bg-layer-03: #ececee;
    --v2-text-text-base: #18181b;
    --v2-text-text-muted: #71717a;
    --v2-icon-icon-muted: #71717a;
    --v2-border-border-subtle: rgba(0,0,0,0.08);
    --v2-border-border-base: rgba(0,0,0,0.12);
    --font-family-sans: ui-sans-serif, system-ui, sans-serif;
    --font-family-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  html, body { height: 100%; }
  body {
    font-family: var(--font-family-sans);
    background: var(--v2-background-bg-deep);
    color: var(--v2-text-text-base);
    display: flex; flex-direction: column; overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }

  /* --- component contracts used by the injected OC Portal UI --- */
  [data-component="button-v2"] {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 28px; padding: 0 10px; border: none; border-radius: 6px;
    font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    white-space: nowrap;
  }
  [data-component="button-v2"][data-variant="ghost-muted"] { background: transparent; color: var(--v2-text-text-muted); }
  [data-component="button-v2"][data-variant="ghost-muted"]:hover { background: var(--v2-background-bg-layer-03); color: var(--v2-text-text-base); }
  [data-component="button-v2"][data-size="large"] { height: 32px; padding: 0 12px; }
  [data-component="icon-button-v2"] {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border: none; border-radius: 6px;
    background: transparent; color: var(--v2-icon-icon-muted); cursor: pointer;
  }
  [data-component="icon-button-v2"]:hover { background: var(--v2-background-bg-layer-03); color: var(--v2-text-text-base); }
  [data-component="menu-v2-content"] {
    min-width: 200px; padding: 4px; border-radius: 8px;
    background: var(--v2-background-bg-layer-01);
    border: 1px solid var(--v2-border-border-subtle);
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    color: var(--v2-text-text-base); font-size: 13px;
  }
  [data-component="menu-v2-item"] {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 6px 8px; border: none; border-radius: 6px;
    background: transparent; color: var(--v2-text-text-base);
    font-family: inherit; font-size: 13px; cursor: pointer; text-align: left;
  }
  [data-component="menu-v2-item"]:hover { background: var(--v2-background-bg-layer-03); }
  [data-slot="menu-v2-separator"] { height: 1px; margin: 4px 0; background: var(--v2-border-border-subtle); }

  /* --- page layout (replica of OpenCode 1.18.10 new-session view) --- */
  .titlebar {
    display: flex; align-items: center; height: 40px; padding: 0 10px;
    border-bottom: 1px solid var(--v2-border-border-subtle);
    background: var(--v2-background-bg-deep); flex-shrink: 0; gap: 4px;
  }
  .titlebar-left { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .tab {
    display: inline-flex; align-items: center; gap: 8px; height: 26px;
    margin-left: 6px; padding: 0 10px; border-radius: 6px;
    background: var(--v2-background-bg-layer-01);
    border: 1px solid var(--v2-border-border-subtle);
    font-size: 12.5px; font-weight: 500;
  }
  .tab .dot { width: 7px; height: 7px; border-radius: 50%; background: #6aa1ff; }
  .tab .close { color: var(--v2-text-text-muted); cursor: pointer; font-size: 14px; line-height: 1; }
  .main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; }
  .watermark {
    font-family: var(--font-family-mono);
    font-size: 170px; font-weight: 900; letter-spacing: -0.04em;
    color: rgba(0,0,0,0.045); line-height: 1; user-select: none;
    text-transform: lowercase; margin-bottom: 48px;
  }
  .composer-wrap { padding: 0 24px 16px; flex-shrink: 0; }
  .composer {
    display: flex; align-items: center; gap: 6px; max-width: 720px; margin: 0 auto;
    background: var(--v2-background-bg-layer-01);
    border: 1px solid var(--v2-border-border-base);
    border-radius: 12px; padding: 8px 10px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .composer input {
    flex: 1; border: none; outline: none; background: transparent;
    font-family: inherit; font-size: 13.5px; color: var(--v2-text-text-base);
    min-width: 0;
  }
  .composer input::placeholder { color: var(--v2-text-text-muted); }
  .model-btn {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 8px; border: 1px solid var(--v2-border-border-subtle);
    border-radius: 6px; background: var(--v2-background-bg-layer-02);
    font-family: inherit; font-size: 12px; color: var(--v2-text-text-base); cursor: pointer;
  }
  .send-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; border-radius: 6px;
    background: #18181b; color: #fafafa; font-size: 14px; cursor: pointer;
  }
  .statusbar {
    display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px;
    border-top: 1px solid var(--v2-border-border-subtle);
    font-size: 12px; color: var(--v2-text-text-muted); flex-shrink: 0;
  }
  .statusbar b { color: var(--v2-text-text-base); font-weight: 600; }
  .statusbar .branch { display: inline-flex; align-items: center; gap: 4px; }
  .statusbar .sep { color: var(--v2-border-border-base); }
  .banner {
    padding: 6px 14px; text-align: center; font-size: 11.5px;
    color: var(--v2-text-text-muted); border-top: 1px solid var(--v2-border-border-subtle);
    flex-shrink: 0; background: var(--v2-background-bg-deep);
  }
</style>
</head>
<body data-new-layout="" class="antialiased overscroll-none overflow-hidden">
  <div class="titlebar">
    <div class="titlebar-left">
      <button data-component="icon-button-v2" aria-label="Menu">\u2630</button>
      <button data-component="icon-button-v2" aria-label="New session">+</button>
      <div class="tab"><span class="dot"></span>New session<span class="close">\u00D7</span></div>
    </div>
    <div id="opencode-titlebar-right" class="titlebar-right" style="margin-left:auto;display:flex;align-items:center;gap:2px;">
      <button data-component="button-v2" data-variant="ghost-muted" data-size="small">\u2318K</button>
      <button data-component="icon-button-v2" aria-label="More">\u2026</button>
    </div>
  </div>

  <div class="main">
    <div class="watermark">opencode</div>
  </div>

  <div class="composer-wrap">
    <div class="composer">
      <button data-component="icon-button-v2" aria-label="Attach">+</button>
      <input placeholder="Ask anything, / for commands, @ for context...">
      <button class="model-btn">Big Pickle \u25BE</button>
      <button class="send-btn" aria-label="Send">\u2191</button>
    </div>
  </div>

  <div class="statusbar">
    <span class="branch"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1v8a2 2 0 0 0 2 2h3"/><circle cx="4" cy="13.5" r="2"/><circle cx="12" cy="4.5" r="2"/><path d="M12 4.5v1a2 2 0 0 1-2 2H7"/></svg>OpenCodePortal</span>
    <span class="sep">/</span>
    <span>main</span>
    <span style="margin-left:auto">Big Pickle</span>
  </div>
  <div class="banner">Connect to 75+ providers to use other models, including Claude, GPT, Gemini, etc</div>
</body>
</html>\`;

const server = http.createServer((req, res) => {
  const pathOnly = (req.url || '/').split('?')[0];
  if (pathOnly === '/global/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '${OPENCODE_VERSION}', healthy: true }));
    return;
  }
  if (pathOnly === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (pathOnly === '/global/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: {"type":"server.connected"}\\n\\n');
    const timer = setInterval(() => res.write('data: {"type":"ping"}\\n\\n'), 200);
    req.on('close', () => clearInterval(timer));
    return;
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, method: req.method, path: req.url, body_len: body.length }));
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    ws.send('echo:' + (Buffer.isBuffer(data) ? data.toString() : data));
  });
});

server.listen(${port}, '127.0.0.1', () => {});
`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function allocatePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr && typeof addr === 'object' ? addr.port : 0));
    });
    srv.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(url, predicate, attempts = 40, interval = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url);
      const body = await resp.json().catch(() => ({}));
      if (predicate(body)) return true;
    } catch {}
    await sleep(interval);
  }
  return false;
}

async function api(gwUrl, path, { method = 'GET', token, body } = {}) {
  const resp = await fetch(gwUrl + path, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), 'workspace', 'tmp');
  mkdirSync(outDir, { recursive: true });
  console.log('Screenshots ->', outDir);

  const tmpDir = mkdtempSync(join(tmpdir(), 'ocp-screenshots-'));
  const procs = [];
  const cleanup = () => {
    for (const p of procs) { try { p.kill('SIGKILL'); } catch {} }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  // -- instances -----------------------------------------------------------
  const instances = [
    { id: 'demo-vm-1', name: 'Demo VM', tags: ['linux', 'demo'] },
    { id: 'gpu-worker', name: 'GPU Worker', tags: ['linux', 'gpu'] },
    { id: 'legacy-dev', name: 'Legacy Dev Server', tags: ['linux'], offline: true },
    { id: 'staging', name: 'Staging Env', tags: ['staging'], offline: true },
  ];

  // -- mock OpenCode server (single upstream for both online instances) ------
  const echoPort = await allocatePort();
  writeFileSync(join(tmpDir, 'echo.cjs'), echoServerScript(echoPort));
  const echoProc = spawn('node', [join(tmpDir, 'echo.cjs')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
  });
  procs.push(echoProc);
  if (!(await waitFor(`http://127.0.0.1:${echoPort}/global/health`, b => b.healthy === true, 40, 300))) {
    cleanup(); throw new Error('Mock OpenCode server failed to start');
  }

  // -- Gateway ---------------------------------------------------------------
  const gwPort = await allocatePort();
  const gwYaml = `gateway:\n  port: ${gwPort}\n  host: 127.0.0.1\n  baseDomain: ${BASE_DOMAIN}\n  sharedSecret: ${SECRET}\n`;
  writeFileSync(join(tmpDir, 'gateway.yaml'), gwYaml);
  const gwProc = spawn('node', ['dist/server/index.js', join(tmpDir, 'gateway.yaml')], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORTAL_DATA_DIR: join(tmpDir, 'gw-data'), LOG_LEVEL: 'warn' },
  });
  procs.push(gwProc);

  const gwUrl = `http://${BASE_DOMAIN}:${gwPort}`;
  if (!(await waitFor(gwUrl + '/health', b => b.status === 'ok'))) {
    cleanup(); throw new Error('Gateway failed to start');
  }

  // -- create instances (online get tokens; offline just exist) --------------
  const assignedTokens = {};
  for (const inst of instances) {
    const { status, data } = await api(gwUrl, '/api/instances', {
      method: 'POST', token: SECRET,
      body: { id: inst.id, name: inst.name, tags: inst.tags },
    });
    if (status !== 201) { cleanup(); throw new Error(`create ${inst.id} -> ${status}`); }
    assignedTokens[inst.id] = data.assignedToken;
  }

  // -- Agents for online instances (both forward to the mock server) ---------
  const onlineInstances = instances.filter(i => !i.offline);
  for (const inst of onlineInstances) {
    const agentYaml = `gateway:\n  url: ws://127.0.0.1:${gwPort}/agent/connect\nregistrationToken: ${assignedTokens[inst.id]}\ntargetHost: 127.0.0.1\ntargetPort: ${echoPort}\nreconnect:\n  baseDelayMs: 1000\n  maxDelayMs: 30000\nheartbeat:\n  intervalMs: 30000\n`;
    const cfg = join(tmpDir, `agent-${inst.id}.yaml`);
    writeFileSync(cfg, agentYaml);
    const proc = spawn('node', ['dist/agent/index.js', cfg], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PORTAL_DATA_DIR: join(tmpDir, `agent-data-${inst.id}`), LOG_LEVEL: 'warn' },
    });
    procs.push(proc);
  }

  // -- wait for both agents online + version probe ----------------------------
  if (!(await waitFor(gwUrl + '/health', b => b.online >= onlineInstances.length, 60, 300))) {
    cleanup(); throw new Error('Agents failed to register');
  }
  await sleep(2500); // allow opencodeVersion probe + immediate heartbeat

  // -- screenshots ------------------------------------------------------------
  const browser = await chromium.launch();
  try {
    // Context 1: apex — login, dashboard, modals
    const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });
    const page = await ctx1.newPage();

    // Login page
    await page.goto(`${gwUrl}/login`);
    await page.waitForSelector('form[method="POST"]');
    await page.screenshot({ path: join(outDir, 'ocp-10-login.png') });

    // Sign in
    await page.fill('input[name="secret"]', SECRET);
    await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
    await page.waitForSelector('tbody tr');

    // Dashboard (light)
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, 'ocp-01-dashboard.png') });

    // Deploy modal — Docker tab
    await page.locator('tbody tr').first().locator('button[aria-label="Deploy"]').click();
    await page.waitForSelector('#deployTabDocker .deploy-code');
    await page.screenshot({ path: join(outDir, 'ocp-04-deploy-docker.png') });

    // Deploy modal — Compose tab
    await page.getByRole('button', { name: 'Compose & .env' }).click();
    await page.waitForSelector('#deployTabCompose .deploy-code');
    await page.screenshot({ path: join(outDir, 'ocp-05-deploy-compose.png') });
    await page.locator('#deployOverlay').getByRole('button', { name: 'Close' }).click();

    // Setup Guide modal
    await page.getByRole('button', { name: 'Setup Guide' }).click();
    await page.waitForSelector('#setupContent pre');
    await page.screenshot({ path: join(outDir, 'ocp-06-setup-guide.png') });
    await page.locator('#setupOverlay').getByRole('button', { name: 'Close' }).click();

    // Add instance modal
    await page.getByRole('button', { name: 'Add Instance' }).click();
    await page.waitForSelector('#addEditOverlay.visible');
    await page.screenshot({ path: join(outDir, 'ocp-07-add-instance.png') });
    await page.locator('#addEditOverlay').getByRole('button', { name: 'Cancel' }).click();

    // Edit instance modal (online instance)
    await page.locator('tbody tr').first().locator('button[aria-label="Edit"]').click();
    await page.waitForSelector('#addEditOverlay.visible');
    await page.screenshot({ path: join(outDir, 'ocp-08-edit-instance.png') });
    await page.locator('#addEditOverlay').getByRole('button', { name: 'Cancel' }).click();

    // Instance detail modal
    await page.locator('tbody tr').first().locator('button[aria-label="Details"]').click();
    await page.waitForSelector('#modalOverlay.visible .row');
    await page.screenshot({ path: join(outDir, 'ocp-09-detail.png') });
    await page.locator('#modalOverlay').getByRole('button', { name: 'Close' }).click();

    // Dashboard — dark theme
    await page.evaluate(() => {
      localStorage.setItem('opencode-color-scheme', 'dark');
      location.reload();
    });
    await page.waitForSelector('tbody tr');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, 'ocp-02-dashboard-dark.png') });

    // Dashboard — Chinese locale
    await page.evaluate(() => {
      document.cookie = 'language=zh-CN; path=/';
      location.reload();
    });
    await page.waitForSelector('tbody tr');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, 'ocp-03-dashboard-zh.png') });
    await ctx1.close();

    // Context 2: instance subdomain — mock OpenCode page with injected nav
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });
    const page2 = await ctx2.newPage();
    await page2.goto(`http://demo-vm-1.localhost:${gwPort}/?token=${SECRET}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page2.waitForSelector('#opencode-titlebar-right', { timeout: 15000 });
    await page2.waitForSelector('#_ocp_portal', { timeout: 15000 });
    await page2.waitForTimeout(600);
    await page2.screenshot({ path: join(outDir, 'ocp-11-instance-page.png') });

    // Injected OC Portal dropdown menu
    await page2.locator('#_ocp_portal').click();
    await page2.waitForSelector('[data-component="menu-v2-content"]', { timeout: 5000 });
    await page2.waitForTimeout(400);
    await page2.screenshot({ path: join(outDir, 'ocp-12-portal-menu.png') });
    await ctx2.close();
  } finally {
    await browser.close();
  }

  console.log('Done. Files:');
  for (const f of ['ocp-01-dashboard.png', 'ocp-02-dashboard-dark.png', 'ocp-03-dashboard-zh.png',
    'ocp-04-deploy-docker.png', 'ocp-05-deploy-compose.png', 'ocp-06-setup-guide.png',
    'ocp-07-add-instance.png', 'ocp-08-edit-instance.png', 'ocp-09-detail.png',
    'ocp-10-login.png', 'ocp-11-instance-page.png', 'ocp-12-portal-menu.png']) {
    console.log('  -', join(outDir, f));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
