// ---------------------------------------------------------------------------
// Tests: server/registry.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InstanceRegistry } from './registry';
import { MemoryStateStore } from '../shared/state';
import WebSocket from 'ws';

// Minimal WebSocket mock for registry interaction
function createMockWs(): any {
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: WebSocket.OPEN, // 1
    _listeners: listeners,
    on(event: string, cb: Function) {
      (listeners[event] ??= []).push(cb);
    },
    // Helper to trigger a 'close' event in tests
    _triggerClose(code: number, reason: string) {
      for (const cb of listeners['close'] ?? []) cb(code, Buffer.from(reason));
    },
    close(_code?: number, _reason?: string) {
      // no-op in mock
    },
  };
}

describe('InstanceRegistry', () => {
  let registry: InstanceRegistry;
  let store: MemoryStateStore;

  beforeEach(() => {
    registry = new InstanceRegistry();
    store = new MemoryStateStore({
      globalToken: 'ocp-gr-test',
      instances: {},
    });
    registry.hydrate(store);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- create ---------------------------------------------------------------

  describe('create', () => {
    it('creates an instance as offline', () => {
      const err = registry.create('vm-1', 'VM One', ['backend']);
      expect(err).toBeNull();

      const list = registry.list();
      expect(list).toHaveLength(1);

      const vm1 = list.find((i) => i.id === 'vm-1')!;
      expect(vm1.name).toBe('VM One');
      expect(vm1.tags).toEqual(['backend']);
      expect(vm1.status).toBe('offline');
      expect(vm1.sessionCount).toBe(0);
      expect(vm1.lastSeen).toBe(0);
    });

    it('creates multiple instances', () => {
      registry.create('vm-1', 'VM One', ['backend']);
      registry.create('vm-2', 'VM Two', ['frontend', 'prod']);

      const list = registry.list();
      expect(list).toHaveLength(2);

      const vm1 = list.find((i) => i.id === 'vm-1')!;
      expect(vm1.name).toBe('VM One');
      expect(vm1.tags).toEqual(['backend']);
      expect(vm1.status).toBe('offline');

      const vm2 = list.find((i) => i.id === 'vm-2')!;
      expect(vm2.name).toBe('VM Two');
      expect(vm2.tags).toEqual(['frontend', 'prod']);
      expect(vm2.status).toBe('offline');
    });

    it('returns error for duplicate id', () => {
      registry.create('vm-1', 'VM One', []);
      const err = registry.create('vm-1', 'Duplicate', []);
      expect(err).toBe('Instance ID already exists');
    });

    it('returns error for invalid id', () => {
      const err = registry.create('', 'VM', []);
      expect(err).toBeTruthy();
      expect(typeof err).toBe('string');
    });

    it('returns error for invalid name', () => {
      const err = registry.create('vm-1', '', []);
      expect(err).toBeTruthy();
      expect(typeof err).toBe('string');
    });
  });

  // -- hydrate + create (replaces old loadFromConfig tests) -----------------

  describe('hydrate', () => {
    it('hydrates instances from store as offline', () => {
      const store2 = new MemoryStateStore({
        globalToken: 'ocp-gr-test',
        instances: {
          'vm-1': { name: 'VM One', tags: ['backend'], assignedToken: 'ocp-at-test1' },
          'vm-2': { name: 'VM Two', tags: ['frontend', 'prod'], assignedToken: 'ocp-at-test2' },
        },
      });
      const reg2 = new InstanceRegistry();
      reg2.hydrate(store2);

      const list = reg2.list();
      expect(list).toHaveLength(2);

      const vm1 = list.find((i) => i.id === 'vm-1')!;
      expect(vm1.name).toBe('VM One');
      expect(vm1.tags).toEqual(['backend']);
      expect(vm1.status).toBe('offline');
      expect(vm1.sessionCount).toBe(0);
      expect(vm1.lastSeen).toBe(0);

      const vm2 = list.find((i) => i.id === 'vm-2')!;
      expect(vm2.name).toBe('VM Two');
      expect(vm2.tags).toEqual(['frontend', 'prod']);
      expect(vm2.status).toBe('offline');
    });

    it('handles empty store', () => {
      const store2 = new MemoryStateStore({
        globalToken: 'ocp-gr-test',
        instances: {},
      });
      const reg2 = new InstanceRegistry();
      reg2.hydrate(store2);
      expect(reg2.list()).toHaveLength(0);
    });
  });

  // -- get / list ------------------------------------------------------------

  describe('get', () => {
    it('returns instance by id', () => {
      registry.create('aa', 'A', []);
      const inst = registry.get('aa');
      expect(inst).toBeDefined();
      expect(inst!.id).toBe('aa');
    });

    it('returns undefined for unknown id', () => {
      registry.create('aa', 'A', []);
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getBySubdomain', () => {
    it('returns instance by subdomain id', () => {
      registry.create('dev', 'Dev', []);
      const inst = registry.getBySubdomain('dev');
      expect(inst).toBeDefined();
      expect(inst!.id).toBe('dev');
    });

    it('returns undefined for unknown subdomain', () => {
      registry.create('aa', 'A', []);
      expect(registry.getBySubdomain('missing')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns a shallow copy (mutations do not affect registry)', () => {
      registry.create('aa', 'A', []);
      const list1 = registry.list();
      list1[0].status = 'online'; // mutate
      const list2 = registry.list();
      expect(list2[0].status).toBe('offline'); // original unchanged
    });
  });

  // -- register --------------------------------------------------------------

  describe('register', () => {
    it('marks instance as online and stores ws reference', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();

      const result = registry.register('vm-1', ws, 90_000, vi.fn());
      expect(result).toBe(true);

      const inst = registry.get('vm-1')!;
      expect(inst.status).toBe('online');
      expect(inst.lastSeen).toBeGreaterThan(0);
    });

    it('returns false for unknown instance id', () => {
      const ws = createMockWs();
      const result = registry.register('nope', ws, 90_000, vi.fn());
      expect(result).toBe(false);
    });

    it('sets instance to offline when ws disconnects', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();

      registry.register('vm-1', ws, 90_000, vi.fn());
      expect(registry.get('vm-1')!.status).toBe('online');

      // Simulate WebSocket close
      ws._triggerClose(1000, 'normal');

      expect(registry.get('vm-1')!.status).toBe('offline');
      expect(registry.getWs('vm-1')).toBeNull();
    });

    it('clears sessionCount when ws disconnects', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();

      registry.register('vm-1', ws, 90_000, vi.fn());
      registry.heartbeat('vm-1', 5, 90_000, vi.fn());
      expect(registry.get('vm-1')!.sessionCount).toBe(5);

      ws._triggerClose(1000, 'normal');

      expect(registry.get('vm-1')!.sessionCount).toBe(0);
    });

    it('clears heartbeat timer on disconnect', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      const onTimeout = vi.fn();

      vi.useFakeTimers();
      registry.register('vm-1', ws, 90_000, onTimeout);

      // Disconnect before timeout fires
      ws._triggerClose(1000, 'normal');
      vi.advanceTimersByTime(100_000);

      // onTimeout should NOT have been called (timer was cleared)
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  // -- getWs -----------------------------------------------------------------

  describe('getWs', () => {
    it('returns ws after registration', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());
      expect(registry.getWs('vm-1')).toBe(ws);
    });

    it('returns null for offline instance', () => {
      registry.create('vm-1', 'VM', []);
      expect(registry.getWs('vm-1')).toBeNull();
    });

    it('returns null for unknown instance', () => {
      expect(registry.getWs('nope')).toBeNull();
    });
  });

  // -- heartbeat -------------------------------------------------------------

  describe('heartbeat', () => {
    it('updates sessionCount and lastSeen', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      const before = registry.get('vm-1')!.lastSeen;
      expect(registry.heartbeat('vm-1', 5, 90_000, vi.fn())).toBe(true);

      const inst = registry.get('vm-1')!;
      expect(inst.sessionCount).toBe(5);
      expect(inst.lastSeen).toBeGreaterThanOrEqual(before);
    });

    it('returns false when sessionCount is unchanged', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      expect(registry.heartbeat('vm-1', 3, 90_000, vi.fn())).toBe(true);
      expect(registry.heartbeat('vm-1', 3, 90_000, vi.fn())).toBe(false);
    });

    it('keeps instance online (resets timeout)', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      const onTimeout = vi.fn();

      vi.useFakeTimers();
      registry.register('vm-1', ws, 90_000, onTimeout);

      // Advance to just before timeout, send heartbeat
      vi.advanceTimersByTime(80_000);
      registry.heartbeat('vm-1', 3, 90_000, onTimeout);

      // The timeout should have been reset — advance past original deadline
      vi.advanceTimersByTime(20_000); // now at 100s total, 10s past original
      expect(onTimeout).not.toHaveBeenCalled();
      expect(registry.get('vm-1')!.status).toBe('online');

      // Advance past the new deadline (80s + 20s + 80s = 180s > 90s from heartbeat)
      vi.advanceTimersByTime(80_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(registry.get('vm-1')!.status).toBe('offline');
    });

    it('is a no-op for unknown instance', () => {
      const onTimeout = vi.fn();
      // Should not throw
      registry.heartbeat('unknown', 0, 90_000, onTimeout);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('marks instance online even if previously offline', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      // Timeout → offline
      vi.useFakeTimers();
      registry.heartbeat('vm-1', 1, 1, vi.fn()); // short timeout
      vi.advanceTimersByTime(10);
      expect(registry.get('vm-1')!.status).toBe('offline');

      // New heartbeat should mark online again
      registry.heartbeat('vm-1', 2, 90_000, vi.fn());
      expect(registry.get('vm-1')!.status).toBe('online');
    });
  });

  // -- heartbeat timeout -----------------------------------------------------

  describe('heartbeat timeout', () => {
    it('fires onTimeout after timeout period without heartbeat', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      const onTimeout = vi.fn();

      vi.useFakeTimers();
      registry.register('vm-1', ws, 1_000, onTimeout);

      expect(registry.get('vm-1')!.status).toBe('online');

      vi.advanceTimersByTime(1_100);
      expect(onTimeout).toHaveBeenCalledWith('vm-1');
      expect(registry.get('vm-1')!.status).toBe('offline');
    });

    it('resets timer on each heartbeat call', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      const onTimeout = vi.fn();

      vi.useFakeTimers();
      registry.register('vm-1', ws, 10_000, onTimeout);

      // Send heartbeat every 5s for 30s
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(5_000);
        registry.heartbeat('vm-1', i, 10_000, onTimeout);
      }

      expect(onTimeout).not.toHaveBeenCalled();
      expect(registry.get('vm-1')!.status).toBe('online');

      // Now let it time out
      vi.advanceTimersByTime(11_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(registry.get('vm-1')!.status).toBe('offline');
    });

    it('onTimeout is called only once even if timer advances far past deadline', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      const onTimeout = vi.fn();

      vi.useFakeTimers();
      registry.register('vm-1', ws, 1_000, onTimeout);

      vi.advanceTimersByTime(100_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  // -- re-registration (supersede old connection) ----------------------------

  describe('re-registration', () => {
    it('replaces old ws with new ws on re-register', () => {
      registry.create('vm-1', 'VM', []);
      const oldWs = createMockWs();
      const newWs = createMockWs();

      registry.register('vm-1', oldWs, 90_000, vi.fn());
      registry.register('vm-1', newWs, 90_000, vi.fn());

      expect(registry.getWs('vm-1')).toBe(newWs);

      // Old ws close event should NOT affect registry
      oldWs._triggerClose(1000, 'old');
      expect(registry.get('vm-1')!.status).toBe('online');
      expect(registry.getWs('vm-1')).toBe(newWs);
    });

    it('new ws disconnect marks instance offline even if old ws disconnects later', () => {
      registry.create('vm-1', 'VM', []);
      const oldWs = createMockWs();
      const newWs = createMockWs();

      registry.register('vm-1', oldWs, 90_000, vi.fn());
      registry.register('vm-1', newWs, 90_000, vi.fn());

      newWs._triggerClose(1000, 'new gone');
      expect(registry.get('vm-1')!.status).toBe('offline');
    });
  });

  // -- remove -----------------------------------------------------------------

  describe('remove', () => {
    it('removes an instance and returns true', () => {
      registry.create('vm-1', 'VM One', ['backend']);
      expect(registry.get('vm-1')).toBeDefined();

      const result = registry.remove('vm-1');
      expect(result).toBe(true);
      expect(registry.get('vm-1')).toBeUndefined();
      expect(registry.getBySubdomain('vm-1')).toBeUndefined();
    });

    it('returns false for unknown instance', () => {
      const result = registry.remove('nope');
      expect(result).toBe(false);
    });

    it('unregisters instance from list after removal', () => {
      registry.create('vm-1', 'VM One', []);
      registry.create('vm-2', 'VM Two', []);
      expect(registry.list()).toHaveLength(2);

      registry.remove('vm-1');
      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0].id).toBe('vm-2');
    });
  });

  // -- verifyToken -----------------------------------------------------------

  describe('verifyToken', () => {
    it('rejects global-style token (deprecated)', () => {
      const result = registry.verifyToken('ocp-gr-test');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown_token');
    });

    it('validates per-instance token and returns instanceId', () => {
      registry.create('vm-1', 'VM One', []);
      const token = registry.getAssignedToken('vm-1')!;
      expect(token).toBeTruthy();

      const result = registry.verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.instanceId).toBe('vm-1');
    });

    it('returns invalid for unknown token', () => {
      const result = registry.verifyToken('ocp-at-bad-token');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown_token');
    });

    it('returns invalid for empty token', () => {
      const result = registry.verifyToken('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('unknown_token');
    });
  });

  // -- update (opencode credentials) ----------------------------------------

  describe('update opencode credentials', () => {
    beforeEach(() => {
      registry.create('vm-1', 'VM One', [], {
        opencodeUser: 'alice',
        opencodePassword: 'secret',
      });
    });

    it('sets opencodeUser and opencodePassword', () => {
      expect(registry.getOpencodeUser('vm-1')).toBe('alice');
      expect(registry.getOpencodePassword('vm-1')).toBe('secret');

      const err = registry.update('vm-1', {
        opencodeUser: 'bob',
        opencodePassword: 'new-secret',
      });
      expect(err).toBeNull();
      expect(registry.getOpencodeUser('vm-1')).toBe('bob');
      expect(registry.getOpencodePassword('vm-1')).toBe('new-secret');
    });

    it('omits fields when not in PATCH body', () => {
      const err = registry.update('vm-1', { name: 'Renamed' });
      expect(err).toBeNull();
      expect(registry.get('vm-1')!.name).toBe('Renamed');
      expect(registry.getOpencodeUser('vm-1')).toBe('alice');
      expect(registry.getOpencodePassword('vm-1')).toBe('secret');
    });

    it('clears opencodeUser and opencodePassword with null', () => {
      expect(registry.update('vm-1', { opencodeUser: null })).toBeNull();
      expect(registry.getOpencodeUser('vm-1')).toBeUndefined();

      registry.update('vm-1', { opencodeUser: 'alice' });
      expect(registry.update('vm-1', { opencodePassword: null })).toBeNull();
      expect(registry.getOpencodePassword('vm-1')).toBeUndefined();
      expect(registry.getOpencodeUser('vm-1')).toBe('alice');
    });

    it('clears with empty string', () => {
      registry.update('vm-1', { opencodeUser: '' });
      expect(registry.getOpencodeUser('vm-1')).toBeUndefined();
    });

    it('excludes cleared credentials from persist state', () => {
      registry.update('vm-1', { opencodeUser: null, opencodePassword: null });
      const persisted = registry.toPersistState()['vm-1'];
      expect(persisted.opencodeUser).toBeUndefined();
      expect(persisted.opencodePassword).toBeUndefined();
    });

    it('create ignores null credentials', () => {
      registry.create('vm-2', 'VM Two', [], {
        opencodeUser: null,
        opencodePassword: null,
      });
      expect(registry.getOpencodeUser('vm-2')).toBeUndefined();
      expect(registry.getOpencodePassword('vm-2')).toBeUndefined();
    });
  });

  // -- setAgentVersion --------------------------------------------------------

  describe('setAgentVersion', () => {
    it('stores agent version on instance (runtime only)', () => {
      registry.create('vm-1', 'VM One', []);
      registry.setAgentVersion('vm-1', '0.2.1');

      expect(registry.get('vm-1')?.agentVersion).toBe('0.2.1');
      expect(registry.list()[0].agentVersion).toBe('0.2.1');
    });

    it('no-ops for unknown instance', () => {
      expect(() => registry.setAgentVersion('nope', '0.2.1')).not.toThrow();
    });
  });

  // -- setOpencodeVersion ------------------------------------------------------

  describe('setOpencodeVersion', () => {
    it('stores opencode version on instance (runtime only)', () => {
      registry.create('vm-1', 'VM One', []);
      registry.setOpencodeVersion('vm-1', '1.18.0');

      expect(registry.get('vm-1')?.opencodeVersion).toBe('1.18.0');
      expect(registry.list()[0].opencodeVersion).toBe('1.18.0');
    });

    it('no-ops for unknown instance', () => {
      expect(() => registry.setOpencodeVersion('nope', '1.18.0')).not.toThrow();
    });
  });

  // -- heartbeat stores opencodeVersion ----------------------------------------

  describe('heartbeat with opencodeVersion', () => {
    it('stores opencodeVersion from heartbeat', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      registry.heartbeat('vm-1', 3, 90_000, vi.fn(), '1.18.0');

      expect(registry.get('vm-1')?.opencodeVersion).toBe('1.18.0');
    });

    it('does not overwrite opencodeVersion when not provided in heartbeat', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      // Set version via heartbeat
      registry.heartbeat('vm-1', 3, 90_000, vi.fn(), '1.18.0');
      expect(registry.get('vm-1')?.opencodeVersion).toBe('1.18.0');

      // Subsequent heartbeat without version should keep the existing one
      registry.heartbeat('vm-1', 5, 90_000, vi.fn());
      expect(registry.get('vm-1')?.opencodeVersion).toBe('1.18.0');
    });

    it('returns true when opencodeVersion changes', () => {
      registry.create('vm-1', 'VM', []);
      const ws = createMockWs();
      registry.register('vm-1', ws, 90_000, vi.fn());

      // First set with sessionCount change → true
      expect(registry.heartbeat('vm-1', 3, 90_000, vi.fn(), '1.18.0')).toBe(true);

      // Same values → false
      expect(registry.heartbeat('vm-1', 3, 90_000, vi.fn(), '1.18.0')).toBe(false);

      // New version → true
      expect(registry.heartbeat('vm-1', 3, 90_000, vi.fn(), '1.19.0')).toBe(true);
    });
  });

  // -- getAssignedToken -------------------------------------------------------

  describe('token accessors', () => {
    it('getAssignedToken returns per-instance token', () => {
      registry.create('vm-1', 'VM One', []);
      const token = registry.getAssignedToken('vm-1');
      expect(token).toBeTruthy();
      expect(token).toMatch(/^ocp-at-/);
    });

    it('getAssignedToken returns undefined for unknown instance', () => {
      expect(registry.getAssignedToken('nope')).toBeUndefined();
    });
  });
});
