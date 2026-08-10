// ---------------------------------------------------------------------------
// StateStore — JSONC persistence for Gateway state
// ---------------------------------------------------------------------------
// Adapter: JSONC file in production, in-memory Map in tests.
// Two adapters = real seam (ADR 0001 decision 2).
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import {
  PersistenceState,
  PersistenceInstance,
  PERSISTENT_STATE_FILE,
} from './types';
import { createLogger, Logger } from './logger';

const log: Logger = createLogger('gateway');

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface StateStore {
  /** Hydrate from persistent storage */
  load(): PersistenceState;
  /** Persist entire state atomically */
  save(state: PersistenceState): void;
  /** Get the data directory path (for tests) */
  getDataDir(): string;
}

// ---------------------------------------------------------------------------
// JSONC file adapter (production)
// ---------------------------------------------------------------------------

export class JsoncStateStore implements StateStore {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  load(): PersistenceState {
    const filePath = path.join(this.dataDir, PERSISTENT_STATE_FILE);
    if (!fs.existsSync(filePath)) {
      return { gatewayId: '', instances: {} };
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const stripped = stripJsoncComments(raw);
      return JSON.parse(stripped) as PersistenceState;
    } catch (err) {
      log.error('state_load', 'failed to parse state file', { error: String(err), path: filePath });
      throw err;
    }
  }

  save(state: PersistenceState): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    chmodIfPossible(this.dataDir, 0o700);
    const filePath = path.join(this.dataDir, PERSISTENT_STATE_FILE);
    const tmp = filePath + '.tmp';
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmp, json, 'utf8');
    chmodIfPossible(tmp, 0o600);
    fs.renameSync(tmp, filePath); // atomic on same fs
    chmodIfPossible(filePath, 0o600);
  }

  getDataDir(): string {
    return this.dataDir;
  }
}

export function chmodIfPossible(targetPath: string, mode: number, logger: Logger = log): void {
  try {
    fs.chmodSync(targetPath, mode);
  } catch (err) {
    logger.warn('state_chmod', 'failed to set restrictive permissions', { path: targetPath, mode: mode.toString(8), error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests)
// ---------------------------------------------------------------------------

export class MemoryStateStore implements StateStore {
  private state: PersistenceState;

  constructor(initial?: Partial<PersistenceState>) {
    this.state = {
      gatewayId: initial?.gatewayId ?? 'test-gateway-id',
      cookieSecret: initial?.cookieSecret,
      instances: initial?.instances ?? {},
    };
  }

  load(): PersistenceState {
    return JSON.parse(JSON.stringify(this.state)); // deep clone
  }

  save(state: PersistenceState): void {
    this.state = JSON.parse(JSON.stringify(state));
  }

  getDataDir(): string {
    return '/tmp/test-data';
  }
}

// ---------------------------------------------------------------------------
// JSONC comment stripping (respects string literals)
// ---------------------------------------------------------------------------

/**
 * Strip JSONC comments from a string, respecting string boundaries.
 * Handles // line comments, /* block comments *, and single/double-quoted strings.
 * Does NOT strip // inside string values.
 */
export function stripJsoncComments(input: string): string {
  const out: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // String literal — copy until closing quote (respect escapes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(ch);
      i++;
      while (i < len) {
        if (input[i] === '\\') {
          out.push(input[i++]); // backslash
          if (i < len) out.push(input[i++]); // escaped char
        } else if (input[i] === quote) {
          out.push(input[i++]);
          break;
        } else {
          out.push(input[i++]);
        }
      }
      continue;
    }

    // Line comment
    if (ch === '/' && i + 1 < len && input[i + 1] === '/') {
      i += 2;
      while (i < len && input[i] !== '\n') i++;
      // keep the newline for line counting
      if (i < len) out.push(input[i++]);
      continue;
    }

    // Block comment
    if (ch === '/' && i + 1 < len && input[i + 1] === '*') {
      i += 2;
      while (i + 1 < len) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // Trailing comma before } or ] (JSON5 compat) — only outside strings
    if (ch === ',') {
      let j = i + 1;
      while (j < len && (input[j] === ' ' || input[j] === '\t' || input[j] === '\n' || input[j] === '\r')) {
        j++;
      }
      if (j < len && (input[j] === '}' || input[j] === ']')) {
        i++;
        continue;
      }
    }

    // Regular character
    out.push(input[i++]);
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_ID_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const VALID_TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/i;

export function validateInstanceId(id: string): string | null {
  if (!id || typeof id !== 'string') return 'Instance ID is required';
  if (!VALID_ID_RE.test(id)) return 'Instance ID must be 1-63 lowercase alphanumeric chars or hyphens (not start/end with hyphen)';
  return null;
}

export function validateInstanceName(name: string): string | null {
  if (!name || typeof name !== 'string') return 'Instance name is required';
  if (name.length > 128) return 'Instance name must be ≤128 chars';
  return null;
}

export function validateTag(tag: string): string | null {
  if (!VALID_TAG_RE.test(tag)) return 'Tag must be 1-32 alphanumeric chars or hyphens';
  return null;
}
