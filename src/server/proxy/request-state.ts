import * as http from 'http';
import type { Logger } from '../../shared/logger';

export interface StreamingRequest {
  res: http.ServerResponse;
  traceId?: string;
}

export const MAX_PENDING_REQUESTS = 1000;
export const MAX_STREAMING_REQUESTS = 500;

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
