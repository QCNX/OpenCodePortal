// ---------------------------------------------------------------------------
// Structured JSON Lines logger
// ---------------------------------------------------------------------------
//
// Outputs one JSON object per line to stderr. Format:
//   {"ts":"...","component":"gateway|agent","level":"info|warn|error","span":"...","msg":"...","data":{...},"traceId":"..."}
//
// Log level control: LOG_LEVEL env var (info | warn | error). Default: info.
//
// Usage:
//   import { createLogger } from '../shared/logger';
//   const log = createLogger('gateway');
//   log.info('http_proxy', 'Proxying request', { method: 'GET', path: '/' }, traceId);
//   log.error('proxy_fail', 'Agent lost', { instanceId }, traceId);
// ---------------------------------------------------------------------------

export interface LogData {
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  component: string;
  level: 'info' | 'warn' | 'error';
  span: string;
  msg: string;
  traceId?: string;
  data?: LogData;
}

/** Internal log level numeric ordering (higher = more severe). */
const LEVEL_ORDER: Record<string, number> = { info: 0, warn: 1, error: 2 };

/** Shared minimum log level. Set via LOG_LEVEL env or setLogLevel(). */
let currentLevel: number = LEVEL_ORDER[process.env.LOG_LEVEL || 'info'] ?? 0;

/** Programmatic override (survives across logger instances). */
export function setLogLevel(level: 'info' | 'warn' | 'error'): void {
  currentLevel = LEVEL_ORDER[level] ?? 0;
}

function formatError(err: unknown): LogData {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export interface Logger {
  info(span: string, msg: string, data?: LogData, traceId?: string): void;
  warn(span: string, msg: string, data?: LogData, traceId?: string): void;
  error(span: string, msg: string, data?: LogData | unknown, traceId?: string): void;
}

export function createLogger(component: 'gateway' | 'agent'): Logger {
  function emit(level: 'info' | 'warn' | 'error', span: string, msg: string, data?: LogData | unknown, traceId?: string): void {
    // Skip if below current log level threshold
    if (LEVEL_ORDER[level] < currentLevel) return;

    const entry: LogEntry = { ts: new Date().toISOString(), component, level, span, msg };
    if (traceId) entry.traceId = traceId;
    if (data !== undefined) {
      entry.data = data instanceof Error ? formatError(data) : (data as LogData);
    }
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  return {
    info(span, msg, data?, traceId?) { emit('info', span, msg, data, traceId); },
    warn(span, msg, data?, traceId?) { emit('warn', span, msg, data, traceId); },
    error(span, msg, data?, traceId?) { emit('error', span, msg, data, traceId); },
  };
}
