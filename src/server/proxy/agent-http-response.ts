import { createLogger, Logger } from '../../shared/logger';
import { parseRawResponse } from './raw-http';
import { ProxyRequestState } from './request-state';
import type { IResponseTransformer } from './response-transformer';
import { overrideCacheHeaders } from './cache-headers';
import { headerToString } from '../../shared/http-headers';

const log: Logger = createLogger('gateway');

export interface AgentHttpResponseOptions {
  instanceId: string;
  requestId: number;
  payload: Buffer;
  state: ProxyRequestState;
  transformer: IResponseTransformer;
}

export function handleAgentHttpResponse(options: AgentHttpResponseOptions): boolean {
  const { instanceId, requestId, payload, state } = options;

  const streaming = state.streamingRequests.get(requestId);
  if (streaming) {
    const traceId = streaming.traceId;
    if (payload.length === 0) {
      streaming.res.end();
      state.cleanupRequest(requestId);
      log.info('http_response', 'sse stream ended', { instanceId, requestId }, traceId);
    } else {
      streaming.res.write(payload);
    }
    return true;
  }

  const res = state.pendingRequests.get(requestId);
  if (!res) return false;

  const traceId = state.requestTraces.get(requestId);
  if (!payload.subarray(0, 8).equals(Buffer.from('HTTP/1.1'))) {
    state.cleanupRequest(requestId);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: invalid agent response');
    log.warn('proxy_error', 'unexpected non-http frame for pending request', { instanceId, requestId }, traceId);
    return true;
  }

  try {
    const parsed = parseRawResponse(payload);
    if (!parsed) {
      state.cleanupRequest(requestId);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: failed to parse response');
      log.error('proxy_error', 'failed to parse agent response', { instanceId, requestId }, traceId);
      return true;
    }

    const contentType = headerToString(parsed.headers['content-type']);
    if (contentType.toLowerCase().includes('text/event-stream')) {
      state.pendingRequests.delete(requestId);
      const timeout = state.requestTimeouts.get(requestId);
      if (timeout) {
        clearTimeout(timeout);
        state.requestTimeouts.delete(requestId);
      }

      const headers = { ...parsed.headers };
      delete headers['content-length'];
      delete headers['transfer-encoding'];

      res.writeHead(parsed.statusCode, parsed.statusMessage, headers);
      if (parsed.body.length > 0) {
        res.write(parsed.body);
      }
      state.streamingRequests.set(requestId, { res, traceId });
      log.info('http_response', 'sse stream started', { instanceId, statusCode: parsed.statusCode, requestId }, traceId);
      return true;
    }

    state.cleanupRequest(requestId);

    let body = parsed.body;
    let headers = { ...parsed.headers };
    if (contentType.toLowerCase().includes('text/html')) {
      const transformed = options.transformer.transformHtmlResponse(headers, body, instanceId);
      body = transformed.body;
      headers = transformed.headers;
    } else {
      overrideCacheHeaders(headers);
    }

    res.writeHead(parsed.statusCode, parsed.statusMessage, headers);
    res.end(body);
    log.info('http_response', 'proxy response', { instanceId, statusCode: parsed.statusCode, requestId }, traceId);
  } catch (err) {
    state.cleanupRequest(requestId);
    log.error('proxy_error', 'error processing agent response', { instanceId, requestId, error: String(err) }, traceId);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  }

  return true;
}
