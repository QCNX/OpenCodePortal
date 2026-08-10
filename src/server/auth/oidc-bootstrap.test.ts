// ---------------------------------------------------------------------------
// Tests: server/auth/oidc-bootstrap.ts — OIDC init retry state machine
// ---------------------------------------------------------------------------
//
// The bootstrap is a pure state machine over an injectable clock and
// scheduler, so every test below is deterministic without vi.useFakeTimers:
// `now` is a mutable counter and `schedule`/`clear` are backed by an
// explicit queue the test drains by hand.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OidcBootstrap } from './oidc-bootstrap';
import { OidcClient } from './oidc-client';
import type { OidcConfig } from '../../shared/types';

// Only the real-OidcClient test exercises discovery; stub the provider module
// so no network call is made and init resolves against a fake IdP config.
vi.mock('openid-client', () => ({
  discovery: vi.fn().mockResolvedValue({
    serverMetadata: () => ({ issuer: 'https://auth.example.com/application/o/opencode/' }),
  }),
  allowInsecureRequests: vi.fn(),
}));

// -- Fake clock + scheduler ---------------------------------------------------

const nowMs = { value: 0 };
const now = (): number => nowMs.value;

interface Pending { handle: unknown; ms: number; }

class FakeScheduler {
  queue: Array<{ handle: unknown; fn: () => void; ms: number }> = [];
  cleared: unknown[] = [];
  private nextId = 1;

  schedule = (fn: () => void, ms: number): unknown => {
    const handle = { id: this.nextId++ };
    this.queue.push({ handle, fn, ms });
    return handle;
  };

  clear = (handle: unknown): void => {
    this.cleared.push(handle);
    this.queue = this.queue.filter((t) => t.handle !== handle);
  };

  pending(): Pending[] {
    return this.queue.map((t) => ({ handle: t.handle, ms: t.ms }));
  }

  /** Run the oldest scheduled callback (attempt body) synchronously. */
  fireNext(): void {
    const t = this.queue.shift();
    if (!t) throw new Error('no pending scheduled task to fire');
    t.fn();
  }
}

/** Yield through the microtask queue (init promise settles + bootstrap handlers). */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// -- Helpers ------------------------------------------------------------------

const OIDC_CFG: OidcConfig = {
  issuer: 'https://auth.example.com/application/o/opencode/',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://gate.example.com/auth/callback',
};

function makeClientStub(): { init: ReturnType<typeof vi.fn>; isConfigured: ReturnType<typeof vi.fn> } {
  return { init: vi.fn(), isConfigured: vi.fn().mockReturnValue(false) };
}

function makeBootstrap(client: unknown, sched: FakeScheduler, extras: Partial<ConstructorParameters<typeof OidcBootstrap>[0]> = {}) {
  const callbacks = {
    onReady: vi.fn(),
    onError: vi.fn(),
    onGiveUp: vi.fn(),
  };
  const bootstrap = new OidcBootstrap({
    client: client as OidcClient,
    oidcCfg: OIDC_CFG,
    baseUrl: 'https://gate.example.com',
    baseDomain: 'example.com',
    now,
    schedule: sched.schedule,
    clear: sched.clear,
    onReady: callbacks.onReady,
    onError: callbacks.onError,
    onGiveUp: callbacks.onGiveUp,
    ...extras,
  });
  return { bootstrap, callbacks };
}

// -- Tests --------------------------------------------------------------------

describe('OidcBootstrap', () => {
  beforeEach(() => { nowMs.value = 0; });

  it('initializes on the first attempt, calls onReady once and never schedules a retry', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init.mockResolvedValue(undefined);
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    await flush();

    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledWith(OIDC_CFG, 'https://gate.example.com', 'example.com');
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
    expect(sched.pending()).toHaveLength(0);
  });

  it('retries with exponential backoff, capped at maxDelayMs', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init.mockRejectedValue(new Error('idp unreachable'));
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    await flush();
    expect(sched.pending()).toEqual([{ handle: expect.any(Object), ms: 2_000 }]);
    expect(callbacks.onError).toHaveBeenLastCalledWith(expect.any(Error), 0, 2_000);

    // Failing attempts 1..7 schedule 4000, 8000, 16000, 32000, then capped at 60000.
    const expectedDelays = [4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000];
    for (const ms of expectedDelays) {
      sched.fireNext();
      await flush();
      expect(sched.pending().at(-1)?.ms).toBe(ms);
      expect(callbacks.onError).toHaveBeenLastCalledWith(expect.any(Error), expect.any(Number), ms);
    }

    expect(callbacks.onError).toHaveBeenCalledTimes(8);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
  });

  it('stops retrying as soon as init succeeds mid-sequence', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    await flush();
    sched.fireNext(); // attempt 1 fails
    await flush();
    sched.fireNext(); // attempt 2 fails
    await flush();
    sched.fireNext(); // attempt 3 succeeds
    await flush();

    expect(client.init).toHaveBeenCalledTimes(4);
    expect(callbacks.onError).toHaveBeenCalledTimes(3);
    expect(callbacks.onError).toHaveBeenNthCalledWith(1, expect.any(Error), 0, 2_000);
    expect(callbacks.onError).toHaveBeenNthCalledWith(2, expect.any(Error), 1, 4_000);
    expect(callbacks.onError).toHaveBeenNthCalledWith(3, expect.any(Error), 2, 8_000);
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(sched.pending()).toHaveLength(0);
  });

  it('gives up after the deadline and never retries again (fail-closed)', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init.mockRejectedValue(new Error('idp unreachable'));
    const { bootstrap, callbacks } = makeBootstrap(client, sched, { timeoutMs: 5_000 });

    bootstrap.start();
    await flush(); // attempt 0 failed → retry pending in 2000ms
    expect(client.init).toHaveBeenCalledTimes(1);

    nowMs.value = 6_000; // deadline (5000ms) passes before the retry fires
    sched.fireNext();

    expect(callbacks.onGiveUp).toHaveBeenCalledTimes(1);
    expect(callbacks.onGiveUp).toHaveBeenCalledWith(6_000); // elapsedMs
    expect(client.init).toHaveBeenCalledTimes(1); // no attempt after the deadline
    expect(sched.pending()).toHaveLength(0);
    expect(callbacks.onReady).not.toHaveBeenCalled();
  });

  it('returns immediately when the client is already configured', () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.isConfigured.mockReturnValue(true);
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();

    expect(client.init).not.toHaveBeenCalled();
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onGiveUp).not.toHaveBeenCalled();
    expect(sched.pending()).toHaveLength(0);
  });

  it('stop() clears the pending retry and nothing fires afterwards', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init.mockRejectedValue(new Error('idp unreachable'));
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    await flush();
    const [pending] = sched.pending();
    expect(pending.ms).toBe(2_000);

    bootstrap.stop();
    bootstrap.stop(); // idempotent

    expect(sched.cleared).toEqual([pending.handle]);
    expect(sched.pending()).toHaveLength(0);
    expect(client.init).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledTimes(1); // the failure itself was reported
  });

  it('stop() during an in-flight init neither schedules a retry nor reports errors', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    client.init.mockRejectedValue(new Error('idp unreachable'));
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    bootstrap.stop(); // before the rejection handler runs
    await flush();

    expect(sched.pending()).toHaveLength(0);
    expect(sched.cleared).toHaveLength(0); // nothing scheduled yet
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onReady).not.toHaveBeenCalled();
  });

  it('reports the failure to onError with the backoff before the next attempt', async () => {
    const sched = new FakeScheduler();
    const client = makeClientStub();
    const boom = new Error('boom');
    client.init.mockRejectedValue(boom);
    const { bootstrap, callbacks } = makeBootstrap(client, sched);

    bootstrap.start();
    await flush();

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(boom, 0, 2_000);
  });

  it('isConfigured() is true after a successful init (real OidcClient, mocked discovery)', async () => {
    const sched = new FakeScheduler();
    const client = new OidcClient();
    const onReady = vi.fn();
    const bootstrap = new OidcBootstrap({
      client,
      oidcCfg: OIDC_CFG,
      baseUrl: 'https://gate.example.com',
      baseDomain: 'example.com',
      now,
      schedule: sched.schedule,
      clear: sched.clear,
      onReady,
    });

    expect(client.isConfigured()).toBe(false);
    bootstrap.start();
    await flush();

    expect(client.isConfigured()).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(sched.pending()).toHaveLength(0);
    client.destroy();
  });
});
