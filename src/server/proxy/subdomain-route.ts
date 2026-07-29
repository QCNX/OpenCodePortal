import * as http from 'http';
import { InstanceRegistry } from '../registry';
import { createLogger, Logger } from '../../shared/logger';
import type { HostRoute } from '../http/host-routing';
import { escapeHtml } from '../webui/escape';
import { AuthGate } from '../auth/gate';

const log: Logger = createLogger('gateway');

export interface SubdomainProxyRouteOptions {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  url: string;
  hostRoute: HostRoute | null;
  reqStart: number;
  registry: InstanceRegistry;
  authGate: AuthGate;
  proxyToAgent: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    instanceId: string,
    path: string,
  ) => void;
}

export function handleSubdomainProxyRoute(options: SubdomainProxyRouteOptions): boolean {
  const { req, res, method, url, hostRoute, reqStart } = options;
  if (hostRoute === 'apex' || hostRoute === null) return false;

  if (options.authGate.respondIfUnauthenticated(req, res, {
    isSubdomain: true,
    reqStart,
    method,
    url,
  })) {
    return true;
  }

  const instance = options.registry.getBySubdomain(hostRoute.subdomain);
  if (!instance) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Instance "${hostRoute.subdomain}" not found`);
    log.info('route_not_found', 'unknown instance', {
      method,
      url,
      instanceId: hostRoute.subdomain,
      duration_ms: Date.now() - reqStart,
    });
    return true;
  }

  if (instance.status === 'offline') {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end(`<h1>503 Service Unavailable</h1><p>Instance "${escapeHtml(instance.name)}" is offline.</p>`);
    log.info('instance_offline', 'instance offline', {
      method,
      url,
      instanceId: instance.id,
      duration_ms: Date.now() - reqStart,
    });
    return true;
  }

  options.proxyToAgent(req, res, instance.id, url);
  return true;
}
