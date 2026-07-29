import * as http from 'http';
import { InstanceRegistry } from '../registry';
import { createLogger, Logger } from '../../shared/logger';
import { PORTAL_CSS } from '../webui/assets/portal-css';
import { PORTAL_FAVICON_SVG } from '../webui/assets/favicon';
import { jsonResponse } from './responses';

const log: Logger = createLogger('gateway');
const gatewayStartedAt = Date.now();

export function handleHealthRoute(
  url: string,
  res: http.ServerResponse,
  registry: InstanceRegistry,
  reqStart: number,
): boolean {
  if (url !== '/health') return false;

  const instances = registry.list();
  const onlineCount = instances.filter((i) => i.status === 'online').length;
  jsonResponse(res, 200, {
    status: 'ok',
    instances: instances.length,
    online: onlineCount,
    uptime: Math.floor((Date.now() - gatewayStartedAt) / 1000),
  });
  log.info('health_check', 'health check', { status: 200, duration_ms: Date.now() - reqStart });
  return true;
}

export function handlePortalStaticRoute(
  path: string,
  url: string,
  res: http.ServerResponse,
  reqStart: number,
): boolean {
  if (url === '/portal.css') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(PORTAL_CSS);
    log.info('http_response', 'portal css served', { status: 200, duration_ms: Date.now() - reqStart });
    return true;
  }

  if (path === '/favicon.svg') {
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(PORTAL_FAVICON_SVG);
    log.info('http_response', 'portal favicon served', { status: 200, duration_ms: Date.now() - reqStart });
    return true;
  }

  if (path === '/favicon.ico') {
    res.writeHead(302, {
      Location: '/favicon.svg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end();
    log.info('http_response', 'favicon redirect', { status: 302, duration_ms: Date.now() - reqStart });
    return true;
  }

  return false;
}
