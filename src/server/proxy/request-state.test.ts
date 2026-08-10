// ---------------------------------------------------------------------------
// Tests: server/proxy/request-state.ts — request lifecycle bookkeeping
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProxyRequestState } from './request-state';
import { isHttpRequestId } from '../../shared/protocol';

interface MockRes {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  body: string;
  writeHead(statusCode: number): MockRes;
  end(body?: string): MockRes;
  write(): boolean;
  once(event: string, cb: () => void): MockRes;
  emitClose(): void;
}

function createMockRes(): MockRes {
  const closeHandlers: (() => void)[] = [];
  const self: any = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    body: '',
    writeHead(statusCode: number) {
      self.statusCode = statusCode;
      self.headersSent = true;
      return self;
    },
    end(body?: string) {
      self.body = body ?? '';
      self.writableEnded = true;
      return self;
    },
    write() {
      return true;
    },
    once(event: string, cb: () => void) {
      if (event === 'close') closeHandlers.push(cb);
      return self;
    },
    emitClose() {
      for (const cb of closeHandlers.splice(0)) cb();
    },
  };
  return self;
}

function stubLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('ProxyRequestState', () => {
  let state: ProxyRequestState;

  beforeEach(() => {
    state = new ProxyRequestState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function register(opts: Partial<Parameters<ProxyRequestState['registerRequest']>[0]> = {}) {
    const res = opts.res ?? (createMockRes() as any);
    return {
      requestId: state.registerRequest({
        res,
        traceId: opts.traceId ?? 'trace-1',
        instanceId: opts.instanceId ?? 'vm-1',
        timeoutMs: opts.timeoutMs ?? 60_000,
        onTimeout: opts.onTimeout ?? vi.fn(),
        onClientClose: opts.onClientClose ?? vi.fn(),
      }),
      res,
    };
  }

  it('allocates an HTTP-namespace requestId and tracks the request', () => {
    const { requestId } = register();

    expect(isHttpRequestId(requestId)).toBe(true);
    expect(state.pendingRequests.has(requestId)).toBe(true);
    expect(state.requestTraces.get(requestId)).toBe('trace-1');
    expect(state.requestInstances.get(requestId)).toBe('vm-1');
    expect(state.requestTimeouts.has(requestId)).toBe(true);
  });

  it('fires onTimeout and cleans up when the timeout elapses', () => {
    const onTimeout = vi.fn();
    const onClientClose = vi.fn();
    const { requestId, res } = register({ onTimeout, onClientClose });

    vi.advanceTimersByTime(60_000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(requestId, 'trace-1');
    expect(state.pendingRequests.has(requestId)).toBe(false);
    expect(state.requestTimeouts.has(requestId)).toBe(false);

    // A late browser close must not double-fire.
    res.emitClose();
    expect(onClientClose).not.toHaveBeenCalled();
  });

  it('fires onClientClose and cancels the timeout when the browser disconnects', () => {
    const onTimeout = vi.fn();
    const onClientClose = vi.fn();
    const { requestId, res } = register({ onTimeout, onClientClose });

    res.emitClose();

    expect(onClientClose).toHaveBeenCalledTimes(1);
    expect(onClientClose).toHaveBeenCalledWith(requestId, 'trace-1');
    expect(state.pendingRequests.has(requestId)).toBe(false);

    // The timeout must be cancelled, not fired later.
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does not fire onClientClose after normal cleanup (response completed)', () => {
    const onClientClose = vi.fn();
    const { requestId, res } = register({ onClientClose });

    state.cleanupRequest(requestId);
    res.emitClose();

    expect(onClientClose).not.toHaveBeenCalled();
  });

  it('does not fire onClientClose twice on repeated close events', () => {
    const onClientClose = vi.fn();
    const { res } = register({ onClientClose });

    res.emitClose();
    res.emitClose();

    expect(onClientClose).toHaveBeenCalledTimes(1);
  });

  it('cancelForInstance writes 502 and cleans up pending requests of that instance', () => {
    const log = stubLogger();
    const keep = register({ instanceId: 'vm-other' });
    const target = register({ instanceId: 'vm-1' });

    state.cancelForInstance('vm-1', log);

    expect(target.res.statusCode).toBe(502);
    expect(target.res.body).toBe('Bad Gateway: agent disconnected');
    expect(state.pendingRequests.has(target.requestId)).toBe(false);
    // Other instance untouched.
    expect(state.pendingRequests.has(keep.requestId)).toBe(true);
  });

  it('promoteToStreaming clears the timeout so a started stream never 504s', () => {
    const onTimeout = vi.fn();
    const onClientClose = vi.fn();
    const { requestId } = register({ onTimeout, onClientClose });

    const entry = state.promoteToStreaming(requestId);

    expect(entry).not.toBeNull();
    expect(state.pendingRequests.has(requestId)).toBe(false);
    expect(state.streamingRequests.has(requestId)).toBe(true);
    expect(state.requestTimeouts.has(requestId)).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('browser close during streaming fires onClientClose', () => {
    const onClientClose = vi.fn();
    const { requestId, res } = register({ onClientClose });

    state.promoteToStreaming(requestId);
    res.emitClose();

    expect(onClientClose).toHaveBeenCalledTimes(1);
    expect(state.streamingRequests.has(requestId)).toBe(false);
  });

  it('returns null from promoteToStreaming when the request is already gone', () => {
    expect(state.promoteToStreaming(9999)).toBeNull();
  });

  it('clearAll cancels timers and empties all maps', () => {
    const onTimeout = vi.fn();
    register({ onTimeout });
    register({ onTimeout });

    state.clearAll();
    vi.advanceTimersByTime(60_000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(state.pendingRequests.size).toBe(0);
    expect(state.requestTimeouts.size).toBe(0);
    expect(state.requestTraces.size).toBe(0);
    expect(state.requestInstances.size).toBe(0);
  });
});
