// E2E mock OpenCode server — HTTP + WebSocket + SSE
// Usage: PORT=13001 node tests/e2e-echo-server.cjs

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 13001);
const HOST = process.env.HOST || '0.0.0.0';

const OC_THEME_STYLE = [
  '<style id="oc-theme">:root{',
  '--font-family-sans:ui-sans-serif,system-ui,sans-serif;',
  '--font-size-small:12px;--font-weight-medium:500;--line-height-large:1.5;',
  '--letter-spacing-normal:0;--radius-md:8px;--radius-sm:4px;',
  '--button-secondary-base:#f9f9f9;--button-secondary-hover:#f0f0f0;',
  '--text-strong:#111;--text-weak:#666;--border-weak-base:rgba(0,0,0,0.12);',
  '--surface-raised-stronger-non-alpha:#fff;--surface-raised-base-hover:rgba(0,0,0,0.06);',
  '--shadow-md:0 4px 12px rgba(0,0,0,0.12);',
  '}</style>',
].join('');

const HTML_PAGE = [
  '<html lang="zh"><head><title>E2E</title>',
  OC_THEME_STYLE,
  '</head><body>',
  '<h1>Hello E2E</h1>',
  '<div class="flex items-center min-w-0 pr-2">',
  '<div id="opencode-titlebar-left" class="flex items-center gap-1 shrink-0 min-w-[24px] min-h-[24px]"></div>',
  '<div class="flex-1"></div>',
  '<div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end min-w-[24px] min-h-[24px]"><button>Status</button><button>Review</button></div>',
  '</div>',
  '</body></html>',
].join('');

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();

    if (req.url === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML_PAGE);
      return;
    }

    if (req.url === '/global/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      res.write('data: {"type":"server.connected"}\n\n');
      const timer = setInterval(() => {
        res.write('data: {"type":"ping"}\n\n');
      }, 200);
      req.on('close', () => clearInterval(timer));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      });
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      method: req.method,
      url: req.url,
      body: body || null,
      authorization: req.headers.authorization || null,
    }));
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = Buffer.isBuffer(data) ? data.toString() : data;
    ws.send('echo:' + msg);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`echo ready on ${HOST}:${PORT}`);
});
