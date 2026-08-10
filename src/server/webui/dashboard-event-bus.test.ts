// ---------------------------------------------------------------------------
// Tests: server/webui/dashboard-event-bus.ts — Dashboard SSE fan-out
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DashboardEventBus } from './dashboard-event-bus';
import type { InstanceView } from '../api/instance-view';

const view = (id: string, sessionCount = 0): InstanceView => ({
  id,
  name: id,
  tags: [],
  status: 'online',
  sessionCount,
  lastSeen: 0,
  connectedAt: 0,
  targetHost: '127.0.0.1',
  targetPort: 4096,
  opencodeUser: '',
  hasOpencodePassword: false,
});

/** Minimal http.ServerResponse stand-in capturing headers/writes/close. */
function createMockRes(): any {
  const writes: string[] = [];
  const closeCallbacks: Array<() => void> = [];
  const res: any = {
    writes,
    statusCode: 0,
    headers: {} as Record<string, string>,
    writeHead(code: number, headers: Record<string, string>) {
      res.statusCode = code;
      res.headers = headers;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    on(event: string, cb: () => void) {
      if (event === 'close') closeCallbacks.push(cb);
    },
    _emitClose() {
      for (const cb of closeCallbacks) cb();
    },
  };
  return res;
}

function payloadOf(chunk: string): unknown {
  return JSON.parse(chunk.replace(/^data: /, '').trim());
}

describe('DashboardEventBus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes a client: SSE headers, immediate snapshot, refresh every 2s', () => {
    vi.useFakeTimers();
    const listInstances = vi.fn(() => [view('vm-1')]);
    const bus = new DashboardEventBus({ listInstances });
    const res = createMockRes();

    bus.subscribe(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    expect(res.writes).toHaveLength(1);
    expect(res.writes[0]).toBe(`data: ${JSON.stringify({ instances: [view('vm-1')] })}\n\n`);

    vi.advanceTimersByTime(2000);
    expect(res.writes).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(res.writes).toHaveLength(3);
    expect(listInstances).toHaveBeenCalledTimes(3);
  });

  it('publish() fans the current snapshot out to every connected client', () => {
    vi.useFakeTimers();
    let snapshot: InstanceView[] = [];
    const listInstances = vi.fn(() => snapshot);
    const bus = new DashboardEventBus({ listInstances });

    const resA = createMockRes();
    const resB = createMockRes();
    bus.subscribe(resA);
    bus.subscribe(resB);
    resA.writes.length = 0;
    resB.writes.length = 0;

    snapshot = [view('vm-2', 4)];
    bus.publish();

    expect(resA.writes).toHaveLength(1);
    expect(resB.writes).toHaveLength(1);
    expect(resA.writes[0]).toBe(`data: ${JSON.stringify({ instances: [view('vm-2', 4)] })}\n\n`);
    expect(resB.writes[0]).toBe(resA.writes[0]);
  });

  it('publish() is a no-op without clients and does not consult the provider', () => {
    vi.useFakeTimers();
    const listInstances = vi.fn(() => [] as InstanceView[]);
    const bus = new DashboardEventBus({ listInstances });

    bus.publish();

    expect(listInstances).not.toHaveBeenCalled();
  });

  it('re-reads the provider on every push — snapshots are never cached', () => {
    vi.useFakeTimers();
    let snapshot: InstanceView[] = [];
    const listInstances = vi.fn(() => snapshot);
    const bus = new DashboardEventBus({ listInstances });
    const res = createMockRes();
    bus.subscribe(res);

    snapshot = [view('vm-2')];
    bus.publish();
    expect(payloadOf(res.writes[1])).toEqual({ instances: [view('vm-2')] });

    snapshot = [];
    bus.publish();
    expect(payloadOf(res.writes[2])).toEqual({ instances: [] });

    expect(listInstances).toHaveBeenCalledTimes(3);
  });

  it('stops pushing and clears the refresh interval once the client closes', () => {
    vi.useFakeTimers();
    const bus = new DashboardEventBus({ listInstances: () => [] as InstanceView[] });
    const res = createMockRes();
    bus.subscribe(res);

    expect(vi.getTimerCount()).toBe(1); // the 2s refresh interval

    res._emitClose();
    expect(vi.getTimerCount()).toBe(0); // interval cleared on close

    vi.advanceTimersByTime(10_000);
    bus.publish();
    expect(res.writes).toHaveLength(1); // only the initial snapshot
  });
});
