import * as http from 'http';
import type { Logger } from '../../shared/logger';
import { nextHttpRequestId } from '../../shared/protocol';

export interface StreamingRequest {
  res: http.ServerResponse;
  traceId?: string;
}

export interface RegisterRequestOptions {
  res: http.ServerResponse;
  traceId: string;
  instanceId: string;
  timeoutMs: number;
  /** Fires when the proxy timeout elapses while the request is still pending. */
  onTimeout: (requestId: number, traceId: string) => void;
  /** Fires when the browser response closes while the request is still tracked. */
  onClientClose: (requestId: number, traceId: string) => void;
}

export const MAX_PENDING_REQUESTS = 1000;
export const MAX_STREAMING_REQUESTS = 500;

/**
 * Central bookkeeping for in-flight proxy requests: registration, timeout,
 * browser-close cleanup, agent-disconnect cleanup, and the pending→streaming
 * (SSE) transition. The state layer only tracks state and timers — deciding
 * what control messages to send is left to the caller's callbacks.
 */
export class ProxyRequestState {
  /** Map of pending requestId -> http.ServerResponse */
  readonly pendingRequests = new Map<number, http.ServerResponse>();
  /** Map of streaming requestId -> response + trace (SSE multi-frame) */
  readonly streamingRequests = new Map<number, StreamingRequest>();
  /** Map of requestId -> proxy timeout handle */
  readonly requestTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  /** Map of requestId -> traceId for HTTP proxy correlation */
  readonly requestTraces = new Map<number, string>();
  /** Map of requestId -> instanceId for disconnect cleanup */
  readonly requestInstances = new Map<number, string>();

  /**
   * Register an in-flight proxy request: allocate the requestId, track the
   * response, arm the timeout, and hook browser-close cleanup. The close
   * listener is guarded by map membership because 'close' also fires on
   * normal completion and after cleanupRequest().
   */
  registerRequest(opts: RegisterRequestOptions): number {
    const requestId = nextHttpRequestId();
    this.pendingRequests.set(requestId, opts.res);
    this.requestTraces.set(requestId, opts.traceId);
    this.requestInstances.set(requestId, opts.instanceId);

    const timeout = setTimeout(() => {
      // Only fire while still pending — cleanup (close, disconnect, response)
      // may have run first.
      if (!this.pendingRequests.has(requestId)) return;
      this.cleanupRequest(requestId);
      opts.onTimeout(requestId, opts.traceId);
    }, opts.timeoutMs);
    this.requestTimeouts.set(requestId, timeout);

    opts.res.once('close', () => {
      if (!this.pendingRequests.has(requestId) && !this.streamingRequests.has(requestId)) return;
      this.cleanupRequest(requestId);
      opts.onClientClose(requestId, opts.traceId);
    });

    return requestId;
  }

  /**
   * Move a pending request into the streaming (SSE) state. Clears the timeout:
   * once a stream has started it must never be terminated with a 504.
   * Returns the streaming entry, or null if the request is no longer pending.
   */
  promoteToStreaming(requestId: number): StreamingRequest | null {
    const res = this.pendingRequests.get(requestId);
    if (!res) return null;
    const traceId = this.requestTraces.get(requestId);
    const timeout = this.requestTimeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
      this.requestTimeouts.delete(requestId);
    }
    this.pendingRequests.delete(requestId);
    const entry: StreamingRequest = { res, traceId };
    this.streamingRequests.set(requestId, entry);
    return entry;
  }

  cleanupRequest(requestId: number): void {
    const timeout = this.requestTimeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
    }
    this.pendingRequests.delete(requestId);
    this.streamingRequests.delete(requestId);
    this.requestTraces.delete(requestId);
    this.requestInstances.delete(requestId);
    this.requestTimeouts.delete(requestId);
  }

  clearAll(): void {
    for (const timeout of this.requestTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.pendingRequests.clear();
    this.streamingRequests.clear();
    this.requestTraces.clear();
    this.requestInstances.clear();
    this.requestTimeouts.clear();
  }

  cancelForInstance(instanceId: string, log: Logger): void {
    for (const [requestId, instId] of [...this.requestInstances]) {
      if (instId !== instanceId) continue;
      const traceId = this.requestTraces.get(requestId);
      const pending = this.pendingRequests.get(requestId);
      if (pending && !pending.headersSent) {
        pending.writeHead(502, { 'Content-Type': 'text/plain' });
        pending.end('Bad Gateway: agent disconnected');
      } else if (pending && !pending.writableEnded) {
        pending.end();
      }

      const streaming = this.streamingRequests.get(requestId);
      if (streaming && !streaming.res.writableEnded) {
        streaming.res.end();
      }

      this.cleanupRequest(requestId);
      log.info('proxy_cleanup', 'cleaned up proxy request on agent disconnect', { requestId, instanceId }, traceId);
    }
  }
}
