// ---------------------------------------------------------------------------
// Gateway — OIDC initialization bootstrap (fail-closed retry state machine)
// ---------------------------------------------------------------------------
//
// The OIDC gate is wired into the Router BEFORE discovery runs, so an
// unavailable IdP never opens an OIDC-only gateway. This module owns only the
// init retry loop: attempt `client.init(...)`, back off on failure, and give
// up after a deadline while the gateway stays fail-closed. Wiring order and
// the fail-closed semantics live in index.ts — the bootstrap never touches
// the Router.
//
// Clock and scheduler are injectable so the state machine is deterministic
// under test without real timers. The caller owns `.unref()` on any Node
// Timeout returned by the injected `schedule`; the bootstrap only stores the
// handle and clears it via `clear` on stop.
// ---------------------------------------------------------------------------

import { OidcClient } from './oidc-client';
import { OidcConfig } from '../../shared/types';

export interface OidcBootstrapOptions {
  client: OidcClient;
  oidcCfg: OidcConfig;
  baseUrl: string;
  baseDomain: string;
  /** Deadline for a successful init; on expiry the loop gives up (default 5 min). */
  timeoutMs?: number;
  /** Backoff base for the first retry (attempt 0 → initialDelayMs, default 2s). */
  initialDelayMs?: number;
  /** Backoff ceiling (default 60s). */
  maxDelayMs?: number;
  /** Injectable clock (default Date.now). */
  now?: () => number;
  /** Injectable scheduler; must return a handle that `clear` can cancel (default setTimeout). */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Injectable clearer for handles returned by `schedule` (default clearTimeout). */
  clear?: (handle: unknown) => void;
  /** Called once after a successful init. */
  onReady?: () => void;
  /** Called after a failed init attempt, with the backoff before the next attempt. */
  onError?: (err: Error, attempt: number, retryInMs: number) => void;
  /** Called when the deadline passes with init still failing — gateway remains fail-closed. */
  onGiveUp?: (elapsedMs: number) => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

export class OidcBootstrap {
  private readonly client: OidcClient;
  private readonly oidcCfg: OidcConfig;
  private readonly baseUrl: string;
  private readonly baseDomain: string;
  private readonly timeoutMs: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly clear: (handle: unknown) => void;
  private readonly onReady?: () => void;
  private readonly onError?: (err: Error, attempt: number, retryInMs: number) => void;
  private readonly onGiveUp?: (elapsedMs: number) => void;

  private initStartMs = 0;
  private running = false;
  private pendingHandle: unknown = null;

  constructor(options: OidcBootstrapOptions) {
    this.client = options.client;
    this.oidcCfg = options.oidcCfg;
    this.baseUrl = options.baseUrl;
    this.baseDomain = options.baseDomain;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = options.clear ?? ((handle) => { clearTimeout(handle as NodeJS.Timeout); });
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.onGiveUp = options.onGiveUp;
  }

  /**
   * Begin the init retry loop. Returns immediately when the client is already
   * configured (or the bootstrap was stopped). The OIDC gate must already be
   * wired by the caller, so a failing init keeps the gateway fail-closed.
   */
  start(): void {
    if (this.running || this.client.isConfigured()) return;
    this.running = true;
    this.initStartMs = this.now();
    this.runAttempt(0);
  }

  /**
   * Cancel any pending retry and halt the in-flight init loop. Idempotent.
   * A stopped bootstrap does not auto-restart; calling start() again begins
   * a fresh retry loop.
   */
  stop(): void {
    this.running = false;
    if (this.pendingHandle !== null) {
      this.clear(this.pendingHandle);
      this.pendingHandle = null;
    }
  }

  private runAttempt(attempt: number): void {
    if (!this.running || this.client.isConfigured()) return;

    const elapsedMs = this.now() - this.initStartMs;
    if (elapsedMs > this.timeoutMs) {
      // Deadline passed — stop retrying, gateway stays fail-closed.
      this.running = false;
      this.onGiveUp?.(elapsedMs);
      return;
    }

    this.client.init(this.oidcCfg, this.baseUrl, this.baseDomain).then(
      () => {
        if (!this.running) return;
        this.running = false;
        this.onReady?.();
      },
      (err: unknown) => {
        if (!this.running) return;
        const retryInMs = Math.min(this.maxDelayMs, this.initialDelayMs * 2 ** attempt);
        this.onError?.(err as Error, attempt, retryInMs);
        this.pendingHandle = this.schedule(() => this.runAttempt(attempt + 1), retryInMs);
      },
    );
  }
}
