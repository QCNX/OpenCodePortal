// ---------------------------------------------------------------------------
// Trace ID generator
// ---------------------------------------------------------------------------
//
// Trace IDs flow through Gateway → Agent → OpenCode via the X-OCP-Trace-Id header.
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';

export const TRACE_HEADER = 'x-ocp-trace-id';

/** Generate a new trace ID for an HTTP request or WS channel. */
export function newTraceId(): string {
  return randomUUID();
}
