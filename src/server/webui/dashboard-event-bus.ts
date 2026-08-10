// ---------------------------------------------------------------------------
// Gateway — dashboard event bus (SSE fan-out)
// ---------------------------------------------------------------------------
//
// Owns the Dashboard live-update SSE fan-out that previously lived inside
// Router:
//   - GET /events subscribers receive an immediate instance snapshot, then a
//     refresh every 2s (the interval doubles as the SSE keep-alive);
//   - Router/index.ts call publish() when instance state changes to push an
//     updated snapshot to every connected client.
//
// The bus is deliberately decoupled from the registry: instance snapshots are
// supplied by an injected callback that is re-invoked on every push, so the
// module stays unit-testable and Router keeps no SSE state.

import * as http from 'http';
import type { InstanceView } from '../api/instance-view';

export interface DashboardEventBusOptions {
  /** Current instance snapshot. Re-invoked on every push — never cached. */
  listInstances: () => InstanceView[];
}

export class DashboardEventBus {
  private readonly clients = new Set<http.ServerResponse>();
  private readonly listInstances: () => InstanceView[];

  constructor(options: DashboardEventBusOptions) {
    this.listInstances = options.listInstances;
  }

  /**
   * Register a Dashboard SSE client: write the stream headers, push the
   * current snapshot immediately, then refresh every 2s. The client's own
   * `close` event stops the interval and unregisters the response.
   */
  subscribe(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    this.clients.add(res);
    this.pushToAll();

    const interval = setInterval(() => {
      this.pushToAll();
    }, 2000);

    res.on('close', () => {
      clearInterval(interval);
      this.clients.delete(res);
    });
  }

  /** Push the current snapshot to all connected clients. No-op when none. */
  publish(): void {
    this.pushToAll();
  }

  private pushToAll(): void {
    if (this.clients.size === 0) return;
    const payload = `data: ${JSON.stringify({
      instances: this.listInstances(),
    })}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }
}
