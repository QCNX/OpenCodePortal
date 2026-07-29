// ---------------------------------------------------------------------------
// Agent — request forwarder
// ---------------------------------------------------------------------------
//
// Receives forwarded requests from Gateway via tunnel,
// proxies them to the local OpenCode server (localhost:<port>),
// and sends responses back through the tunnel.
//
// Payload format: raw HTTP/1.1 request/response bytes.
// WebSocket channels: established via channel_open control message,
// binary frames relayed directly.
// ---------------------------------------------------------------------------

import * as http from 'http';
import WebSocket from 'ws';
import { AgentTunnel } from './tunnel';
import { createLogger, Logger } from '../shared/logger';
import { encodeWsTunnelPayload, decodeWsTunnelPayload } from '../shared/protocol';
import { TRACE_HEADER } from '../shared/trace';
import { headerToString } from '../shared/http-headers';

const log: Logger = createLogger('agent');

/** Maximum buffered non-SSE upstream response body accepted by the Agent (50 MiB). */
export const MAX_PROXY_RESPONSE_BODY_BYTES = 50 * 1024 * 1024;
const MAX_PENDING_CHANNEL_MESSAGES = 100;
const MAX_PENDING_CHANNEL_BYTES = 1024 * 1024;

function parseByteHeader(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}


interface ActiveHttpRequest {
  req: http.ClientRequest;
  res?: http.IncomingMessage;
  canceled: boolean;
}

export class Forwarder {
  private agent: http.Agent;
  private activeChannels = new Map<number, WebSocket>();
  private pendingChannelMessages = new Map<number, { data: Buffer; isBinary: boolean }[]>();
  private activeHttpRequests = new Map<number, ActiveHttpRequest>();
  private canceledHttpRequests = new Set<number>();
  private activeRequestCount = 0;

  constructor(
    private localPort: number,
    private localHost: string,
    private tunnel: AgentTunnel,
    maxSockets = 50,
  ) {
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets,
    });
  }

  /** Get current number of active HTTP requests. */
  getActiveRequestCount(): number {
    return this.activeRequestCount;
  }

  /**
   * Handle a forwarded request from Gateway.
   * If requestId matches an active WS channel → relay to localhost WS.
   * Otherwise → parse as raw HTTP and proxy to localhost.
   */
  handleRequest(requestId: number, payload: Buffer): void {
    // Check if this is WS channel data
    const channelWs = this.activeChannels.get(requestId);
    if (channelWs) {
      const decoded = decodeWsTunnelPayload(payload);
      if (!decoded) return;

      if (channelWs.readyState === WebSocket.OPEN) {
        channelWs.send(decoded.data, { binary: decoded.isBinary });
        return;
      }
      // Buffer messages while connecting
      if (channelWs.readyState === WebSocket.CONNECTING) {
        const buf = this.pendingChannelMessages.get(requestId) || [];
        const pendingBytes = buf.reduce((sum, msg) => sum + msg.data.length, 0);
        if (buf.length >= MAX_PENDING_CHANNEL_MESSAGES || pendingBytes + decoded.data.length > MAX_PENDING_CHANNEL_BYTES) {
          log.warn('ws_channel_backpressure', 'pending channel buffer limit exceeded', {
            channelId: requestId,
            messages: buf.length,
            bytes: pendingBytes + decoded.data.length,
          });
          channelWs.close(1013, 'pending buffer limit exceeded');
          this.activeChannels.delete(requestId);
          this.pendingChannelMessages.delete(requestId);
          this.tunnel.sendChannelControl({ type: 'channel_error', channelId: requestId, message: 'pending buffer limit exceeded' });
          return;
        }
        buf.push({ data: decoded.data, isBinary: decoded.isBinary });
        this.pendingChannelMessages.set(requestId, buf);
        return;
      }
      // Channel is closing/closed → discard
      return;
    }
    const parsed = parseRawHttp(payload);
    if (!parsed) {
      log.error('forward_error', 'failed to parse raw http', { requestId });
      return;
    }

    const { method, path, headers, body } = parsed;
    const traceId = headerToString(headers[TRACE_HEADER]) || undefined;
    this.activeRequestCount++;
    this.tunnel.setSessionCount(this.activeRequestCount);

    log.info('forward_http', 'forwarding request to opencode', { method, path, host: this.localHost, port: this.localPort }, traceId);

    const req = http.request(
      {
        hostname: this.localHost,
        port: this.localPort,
        method,
        path,
        headers,
        agent: this.agent,
      },
      (res) => {
        const active = this.activeHttpRequests.get(requestId);
        if (!active || active.canceled) {
          res.destroy();
          return;
        }
        active.res = res;

        const contentType = headerToString(res.headers['content-type']).toLowerCase();
        if (isEventStreamContentType(contentType)) {
          this.forwardStreamingResponse(requestId, res, traceId);
          return;
        }

        const declaredBodyBytes = parseByteHeader(res.headers['content-length']);
        if (declaredBodyBytes !== null && declaredBodyBytes > MAX_PROXY_RESPONSE_BODY_BYTES) {
          this.finishRequest(requestId);
          log.warn('forward_response_too_large', 'upstream response content-length too large', {
            requestId,
            bytes: declaredBodyBytes,
            limit: MAX_PROXY_RESPONSE_BODY_BYTES,
          }, traceId);
          this.sendErrorResponse(requestId, 502, 'Bad Gateway: response too large');
          res.destroy();
          return;
        }

        // Buffer non-streaming responses into a single frame
        const chunks: Buffer[] = [];
        chunks.push(Buffer.from(serializeResponseHeaders(res.statusCode!, res.statusMessage!, res.headers)));
        let bodyBytes = 0;
        let rejected = false;

        res.on('data', (chunk: Buffer) => {
          if (rejected) return;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_PROXY_RESPONSE_BODY_BYTES) {
            rejected = true;
            this.finishRequest(requestId);
            log.warn('forward_response_too_large', 'upstream response body too large', {
              requestId,
              bytes: bodyBytes,
              limit: MAX_PROXY_RESPONSE_BODY_BYTES,
            }, traceId);
            this.sendErrorResponse(requestId, 502, 'Bad Gateway: response too large');
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (rejected) return;
          this.finishRequest(requestId);
          const responseBuf = Buffer.concat(chunks);
          this.tunnel.sendBinary(requestId, responseBuf);
        });

        res.on('error', (err) => {
          if (rejected) return;
          if (this.isCanceled(requestId)) return;
          this.finishRequest(requestId);
          log.error('forward_error', 'response error', { requestId, error: err.message }, traceId);
          this.sendErrorResponse(requestId, 502, 'Bad Gateway');
        });
      },
    );
    this.activeHttpRequests.set(requestId, { req, canceled: false });

    req.on('error', (err) => {
      if (this.isCanceled(requestId)) return;
      this.finishRequest(requestId);
      log.error('forward_error', 'request error', { requestId, error: err.message }, traceId);
      this.sendErrorResponse(requestId, 502, 'Bad Gateway');
    });

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  }

  /** Cancel a forwarded HTTP/SSE request whose browser client went away. */
  cancelRequest(requestId: number): void {
    const active = this.activeHttpRequests.get(requestId);
    if (!active) return;
    active.canceled = true;
    this.markCanceled(requestId);
    active.res?.destroy();
    active.req.destroy();
    this.finishRequest(requestId);
    log.info('forward_cancel', 'canceled upstream request', { requestId });
  }

  /** Cancel all active HTTP/SSE requests (called on tunnel disconnect). */
  cancelAllRequests(): void {
    for (const requestId of [...this.activeHttpRequests.keys()]) {
      this.cancelRequest(requestId);
    }
  }

  /** Open a WebSocket channel to localhost OpenCode. */
  openChannel(channelId: number, path: string, headers?: Record<string, string>): void {
    const wsUrl = `ws://${this.localHost}:${this.localPort}${path}`;
    const traceId = headers?.[TRACE_HEADER];
    const headerCount = headers ? Object.keys(headers).length : 0;
    log.info('ws_channel_open', 'opening ws channel', { channelId, path, headerCount }, traceId);

    try {
      const wsOptions: any = {};
      if (headers) {
        wsOptions.headers = headers;
      }
      const ws = new WebSocket(wsUrl, wsOptions);
      this.activeChannels.set(channelId, ws);

      ws.on('open', () => {
        log.info('ws_channel_connected', 'ws channel connected', { channelId }, traceId);
        this.tunnel.sendChannelControl({ type: 'channel_opened', channelId });
        // Flush buffered messages
        const pending = this.pendingChannelMessages.get(channelId);
        if (pending) {
          this.pendingChannelMessages.delete(channelId);
          for (const msg of pending) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg.data, { binary: msg.isBinary });
          }
        }
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        this.tunnel.sendBinary(channelId, encodeWsTunnelPayload(buf, isBinary));
      });

      ws.on('close', (code: number) => {
        log.info('ws_channel_close', 'ws channel closed by localhost', { channelId, code }, traceId);
        this.activeChannels.delete(channelId);
        this.pendingChannelMessages.delete(channelId);
        this.tunnel.sendChannelControl({ type: 'channel_closed', channelId });
      });

      ws.on('error', (err: Error) => {
        log.error('ws_channel_error', 'ws channel error', { channelId, error: err.message }, traceId);
        this.activeChannels.delete(channelId);
        this.pendingChannelMessages.delete(channelId);
        this.tunnel.sendChannelControl({ type: 'channel_error', channelId, message: err.message });
      });
    } catch (err: any) {
      log.error('ws_channel_error', 'failed to open ws channel', { channelId, error: err.message }, traceId);
      this.tunnel.sendChannelControl({ type: 'channel_error', channelId, message: err.message });
    }
  }

  /** Close a WebSocket channel. */
  closeChannel(channelId: number): void {
    const ws = this.activeChannels.get(channelId);
    if (ws) {
      ws.close(1000, 'gateway closed channel');
      this.activeChannels.delete(channelId);
    }
    // Send acknowledgment even if already cleaned up
    this.tunnel.sendChannelControl({ type: 'channel_closed', channelId });
  }

  /** Close all active channels (called on disconnect). */
  closeAllChannels(): void {
    for (const [channelId, ws] of this.activeChannels) {
      ws.close(1000, 'agent disconnecting');
      log.info('ws_channel_cleanup', 'closed ws channel on disconnect', { channelId });
    }
    this.activeChannels.clear();
  }

  /** Stream SSE responses as multi-frame tunnel messages (headers, chunks, empty end). */
  private forwardStreamingResponse(
    requestId: number,
    res: http.IncomingMessage,
    traceId?: string,
  ): void {
    let headersSent = false;

    const sendHeaders = () => {
      if (headersSent) return;
      headersSent = true;
      const headerBuf = Buffer.from(
        serializeResponseHeaders(res.statusCode!, res.statusMessage!, res.headers),
      );
      this.tunnel.sendBinary(requestId, headerBuf);
    };

    const finish = () => {
      if (!this.finishRequest(requestId)) return;
      this.tunnel.sendBinary(requestId, Buffer.alloc(0));
    };

    res.on('data', (chunk: Buffer) => {
      if (this.isCanceled(requestId)) return;
      sendHeaders();
      this.tunnel.sendBinary(requestId, chunk);
    });

    res.on('end', () => {
      if (this.isCanceled(requestId)) return;
      sendHeaders();
      finish();
      log.info('forward_sse_end', 'sse stream ended', { requestId }, traceId);
    });

    res.on('error', (err) => {
      if (this.isCanceled(requestId)) return;
      log.error('forward_error', 'sse response error', { requestId, error: err.message }, traceId);
      sendHeaders();
      finish();
    });
  }

  private finishRequest(requestId: number): boolean {
    if (!this.activeHttpRequests.delete(requestId)) return false;
    this.canceledHttpRequests.delete(requestId);
    this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
    this.tunnel.setSessionCount(this.activeRequestCount);
    return true;
  }

  private isCanceled(requestId: number): boolean {
    return this.canceledHttpRequests.has(requestId) || (this.activeHttpRequests.get(requestId)?.canceled ?? false);
  }

  private markCanceled(requestId: number): void {
    this.canceledHttpRequests.add(requestId);
    const cleanup = setTimeout(() => {
      this.canceledHttpRequests.delete(requestId);
    }, 60_000);
    cleanup.unref?.();
  }

  private sendErrorResponse(requestId: number, statusCode: number, message: string): void {
    const body = JSON.stringify({ error: message });
    const buf = Buffer.from(
      `HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] || 'Error'}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `\r\n` +
      body,
    );
    this.tunnel.sendBinary(requestId, buf);
  }
}

/** True when upstream response should be streamed (not buffered). */
export function isEventStreamContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/event-stream');
}

/** Serialize HTTP/1.1 response status line + headers (no body). */
export function serializeResponseHeaders(
  statusCode: number,
  statusMessage: string,
  headers: http.IncomingHttpHeaders,
): string {
  const lines: string[] = [`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`];
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      const vals = Array.isArray(value) ? value : [value];
      for (const v of vals) {
        lines.push(`${key}: ${v}\r\n`);
      }
    }
  }
  lines.push('\r\n');
  return lines.join('');
}

// -- Raw HTTP parser ---------------------------------------------------------

export interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

/**
 * Parse a raw HTTP/1.1 request from bytes.
 * Returns null if parsing fails.
 */
export function parseRawHttp(data: Buffer): ParsedRequest | null {
  const text = data.toString('utf8');
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerSection = text.substring(0, headerEnd);
  const body = data.subarray(headerEnd + 4);

  const lines = headerSection.split('\r\n');
  if (lines.length === 0) return null;

  // First line: "METHOD /path HTTP/1.1"
  const requestLine = lines[0].split(' ');
  if (requestLine.length < 2) return null;
  const method = requestLine[0];
  const path = requestLine[1];

  // Headers
  const headers: Record<string, string | string[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      const key = lines[i].substring(0, colon).trim().toLowerCase();
      const value = lines[i].substring(colon + 1).trim();
      const existing = headers[key];
      if (existing === undefined) {
        headers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        headers[key] = [existing, value];
      }
    }
  }

  return { method, path, headers, body };
}
