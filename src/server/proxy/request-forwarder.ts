import * as http from 'http';
import { InstanceRegistry } from '../registry';
import type { AgentTransport } from '../agent-transport';
import { nextHttpRequestId } from '../../shared/protocol';
import { newTraceId, TRACE_HEADER } from '../../shared/trace';
import { createLogger, Logger } from '../../shared/logger';
import { stripQueryParam } from '../http/query';
import { serializeHttpRequest } from './raw-http';
import {
  ProxyRequestState,
  MAX_PENDING_REQUESTS,
  MAX_STREAMING_REQUESTS,
} from './request-state';

const log: Logger = createLogger('gateway');

/** Maximum buffered request body accepted by the HTTP proxy (50 MiB). */
export const MAX_PROXY_REQUEST_BODY_BYTES = 50 * 1024 * 1024;

function parseByteHeader(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export interface AgentRequestProxyOptions {
  registry: InstanceRegistry;
  getTransport: () => AgentTransport | null;
  state: ProxyRequestState;
}

export class AgentRequestProxy {
  constructor(private options: AgentRequestProxyOptions) {}

  proxyToAgent(req: http.IncomingMessage, res: http.ServerResponse, instanceId: string, path: string): void {
    const state = this.options.state;
    if (state.pendingRequests.size >= MAX_PENDING_REQUESTS || state.streamingRequests.size >= MAX_STREAMING_REQUESTS) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Server overloaded — too many pending requests');
      log.warn('proxy_overload', 'too many pending or streaming requests', {
        method: req.method,
        url: req.url,
        pending: state.pendingRequests.size,
        streaming: state.streamingRequests.size,
      });
      return;
    }

    const declaredBodyBytes = parseByteHeader(req.headers['content-length']);
    if (declaredBodyBytes !== null && declaredBodyBytes > MAX_PROXY_REQUEST_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload Too Large');
      log.warn('proxy_request_too_large', 'proxy request content-length too large', {
        method: req.method,
        url: req.url,
        instanceId,
        bytes: declaredBodyBytes,
        limit: MAX_PROXY_REQUEST_BODY_BYTES,
      });
      return;
    }

    const traceId = newTraceId();
    req.headers[TRACE_HEADER] = traceId;

    const password = this.options.registry.getOpencodePassword(instanceId);
    if (password) {
      const user = this.options.registry.getOpencodeUser(instanceId) || 'opencode';
      req.headers['authorization'] = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
    } else {
      delete req.headers['authorization'];
    }

    log.info('http_proxy', 'proxying request to agent', { method: req.method, url: req.url, path, instanceId }, traceId);

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_PROXY_REQUEST_BODY_BYTES) {
        rejected = true;
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
        log.warn('proxy_request_too_large', 'proxy request body too large', {
          instanceId,
          bytes: bodyBytes,
          limit: MAX_PROXY_REQUEST_BODY_BYTES,
        }, traceId);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const body = Buffer.concat(chunks);
      const upstreamPath = stripQueryParam(path, 'auth_token');
      const rawRequest = serializeHttpRequest(req, body, upstreamPath);
      const requestId = nextHttpRequestId();

      state.pendingRequests.set(requestId, res);
      state.requestTraces.set(requestId, traceId);
      state.requestInstances.set(requestId, instanceId);

      const timeout = setTimeout(() => {
        this.cancelProxyRequest(instanceId, requestId, traceId);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'text/plain' });
          res.end('Gateway Timeout');
        }
        log.warn('proxy_timeout', 'proxy request timed out', { instanceId, requestId }, traceId);
      }, 60_000);
      state.requestTimeouts.set(requestId, timeout);

      res.once('close', () => {
        this.cancelProxyRequest(instanceId, requestId, traceId);
      });

      const sent = this.options.getTransport()?.sendToAgent(instanceId, requestId, rawRequest);
      if (!sent) {
        state.cleanupRequest(requestId);
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Agent connection lost');
        log.error('proxy_error', 'agent connection lost', { instanceId, requestId }, traceId);
      }
    });
  }

  private cancelProxyRequest(instanceId: string, requestId: number, traceId?: string): void {
    const state = this.options.state;
    if (!state.pendingRequests.has(requestId) && !state.streamingRequests.has(requestId)) return;
    this.options.getTransport()?.sendControlToAgent(instanceId, { type: 'request_cancel', requestId });
    state.cleanupRequest(requestId);
    log.info('proxy_cancel', 'canceled upstream proxy request', { instanceId, requestId }, traceId);
  }
}
