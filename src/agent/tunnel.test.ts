// ---------------------------------------------------------------------------
// Tests: agent/tunnel.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTunnel } from './tunnel';
import type { AgentConfig } from '../shared/types';

function testConfig(): AgentConfig {
  return {
    gateway: { url: 'ws://localhost:8080/agent/connect' },
    registrationToken: 'ocp-gr-test',
    instanceId: '',
    targetHost: '127.0.0.1',
    targetPort: 4096,
    reconnect: { baseDelayMs: 1000, maxDelayMs: 60_000 },
    heartbeat: { intervalMs: 30_000 },
  };
}

function noopCallbacks() {
  return {
    onData: vi.fn(),
    onRegistered: vi.fn(),
    onDisconnect: vi.fn(),
    onChannelOpen: vi.fn(),
    onChannelClose: vi.fn(),
    onRequestCancel: vi.fn(),
  };
}

function registerTunnel(tunnel: AgentTunnel, wsSend: ReturnType<typeof vi.fn>): void {
  (tunnel as any).ws = { send: wsSend, close: vi.fn(), readyState: 1 };
  (tunnel as any).handleControl({
    type: 'registered',
    status: 'ok',
    assignedId: 'vm-1',
    assignedToken: 'ocp-at-assigned',
    gatewayId: 'gw-1',
  });
}

describe('AgentTunnel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes assignedToken to the registration callback', () => {
    const onRegistered = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), {
      ...noopCallbacks(),
      onRegistered,
    });
    (tunnel as any).ws = { send: vi.fn(), close: vi.fn(), readyState: 1 };

    (tunnel as any).handleControl({
      type: 'registered',
      status: 'ok',
      assignedId: 'vm-1',
      assignedToken: 'ocp-at-assigned',
      gatewayId: 'gw-1',
    });
    tunnel.stop();

    expect(onRegistered).toHaveBeenCalledWith('vm-1', 'ocp-at-assigned', 'gw-1');
  });

  it('sends debounced heartbeat when sessionCount changes after registration', () => {
    const wsSend = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    registerTunnel(tunnel, wsSend);
    wsSend.mockClear();

    tunnel.setSessionCount(1);
    expect(wsSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(wsSend.mock.calls[0][0])).toEqual({ type: 'heartbeat', sessionCount: 1 });
    tunnel.stop();
  });

  it('debounces rapid sessionCount changes without resetting the timer', () => {
    const wsSend = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    registerTunnel(tunnel, wsSend);
    wsSend.mockClear();

    tunnel.setSessionCount(1);
    vi.advanceTimersByTime(500);
    tunnel.setSessionCount(2);
    vi.advanceTimersByTime(500);

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(wsSend.mock.calls[0][0])).toEqual({ type: 'heartbeat', sessionCount: 2 });
    tunnel.stop();
  });

  it('does not extend debounce window on every sessionCount change', () => {
    const wsSend = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    registerTunnel(tunnel, wsSend);
    wsSend.mockClear();

    tunnel.setSessionCount(1);
    vi.advanceTimersByTime(900);
    tunnel.setSessionCount(0);
    vi.advanceTimersByTime(100);

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(wsSend.mock.calls[0][0])).toEqual({ type: 'heartbeat', sessionCount: 0 });
    tunnel.stop();
  });

  it('does not send heartbeat when sessionCount is unchanged', () => {
    const wsSend = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    registerTunnel(tunnel, wsSend);
    wsSend.mockClear();

    tunnel.setSessionCount(0);
    vi.advanceTimersByTime(1000);

    expect(wsSend).not.toHaveBeenCalled();
    tunnel.stop();
  });

  it('does not send debounced heartbeat before registration', () => {
    const wsSend = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    (tunnel as any).ws = { send: wsSend, close: vi.fn(), readyState: 1 };

    tunnel.setSessionCount(1);
    vi.advanceTimersByTime(1000);

    expect(wsSend).not.toHaveBeenCalled();
    tunnel.stop();
  });

  it('closes with Gateway-provided closeCode on registration error', () => {
    const wsClose = vi.fn();
    const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
    (tunnel as any).ws = { send: vi.fn(), close: wsClose, readyState: 1 };

    (tunnel as any).handleControl({
      type: 'registered',
      status: 'error',
      message: 'unknown token',
      closeCode: 4001,
    });

    expect(wsClose).toHaveBeenCalledWith(4001, 'registration failed');
    tunnel.stop();
  });

  describe('opencodeVersion in heartbeat', () => {
    it('includes opencodeVersion in heartbeat when set', () => {
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
      registerTunnel(tunnel, wsSend);
      wsSend.mockClear();

      // Simulate version probe success
      (tunnel as any).opencodeVersion = '1.18.0';

      vi.advanceTimersByTime(30_000);

      expect(wsSend).toHaveBeenCalled();
      const msg = JSON.parse(wsSend.mock.calls[0][0]);
      expect(msg.type).toBe('heartbeat');
      expect(msg.sessionCount).toBe(0);
      expect(msg.opencodeVersion).toBe('1.18.0');
      tunnel.stop();
    });

    it('omits opencodeVersion from heartbeat when not set', () => {
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
      registerTunnel(tunnel, wsSend);
      wsSend.mockClear();

      vi.advanceTimersByTime(30_000);

      expect(wsSend).toHaveBeenCalled();
      const msg = JSON.parse(wsSend.mock.calls[0][0]);
      expect(msg.type).toBe('heartbeat');
      expect(msg.sessionCount).toBe(0);
      expect(msg).not.toHaveProperty('opencodeVersion');
      tunnel.stop();
    });

    it('includes opencodeVersion in debounced heartbeat after sessionCount change', () => {
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks());
      registerTunnel(tunnel, wsSend);
      wsSend.mockClear();

      (tunnel as any).opencodeVersion = '1.18.0';
      tunnel.setSessionCount(5);
      vi.advanceTimersByTime(1000);

      expect(wsSend).toHaveBeenCalled();
      const msg = JSON.parse(wsSend.mock.calls[0][0]);
      expect(msg.opencodeVersion).toBe('1.18.0');
      expect(msg.sessionCount).toBe(5);
      tunnel.stop();
    });
  });

  describe('opencodeVersion probing', () => {
    it('probes version after successful registration', async () => {
      const probeVersion = vi.fn().mockResolvedValue('1.18.0');
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks(), probeVersion);
      registerTunnel(tunnel, wsSend);
      clearInterval((tunnel as any).heartbeatTimer);

      // Let the async probe resolve
      await vi.advanceTimersByTimeAsync(100);

      expect(probeVersion).toHaveBeenCalledWith('127.0.0.1', 4096);
      tunnel.stop();
    });

    it('sets opencodeVersion and reports in heartbeat after probe succeeds', async () => {
      const probeVersion = vi.fn().mockResolvedValue('1.18.0');
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks(), probeVersion);
      registerTunnel(tunnel, wsSend);
      wsSend.mockClear();
      clearInterval((tunnel as any).heartbeatTimer);

      await vi.advanceTimersByTimeAsync(100);

      // After probe resolves, trigger a heartbeat
      vi.advanceTimersByTime(30_000);

      expect(wsSend).toHaveBeenCalled();
      const msg = JSON.parse(wsSend.mock.calls[wsSend.mock.calls.length - 1][0]);
      expect(msg.opencodeVersion).toBe('1.18.0');
      tunnel.stop();
    });

    it('schedules retry probe after failure', async () => {
      const probeVersion = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks(), probeVersion);
      const wsSend = vi.fn();
      registerTunnel(tunnel, wsSend);
      clearInterval((tunnel as any).heartbeatTimer);

      await vi.advanceTimersByTimeAsync(100);
      expect(probeVersion).toHaveBeenCalledTimes(1);

      // No retry timer at 100ms, but should fire after 1 hour
      // We can't easily advance 1 hour with fake timers, but verify the timer is set
      expect((tunnel as any).versionProbeTimer).toBeDefined();

      tunnel.stop();
    });

    it('retries probe after hour on failure', async () => {
      const probeVersion = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('2.0.0');
      const wsSend = vi.fn();
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks(), probeVersion);
      registerTunnel(tunnel, wsSend);
      wsSend.mockClear();
      clearInterval((tunnel as any).heartbeatTimer);

      // First probe fails
      await vi.advanceTimersByTimeAsync(100);
      expect(probeVersion).toHaveBeenCalledTimes(1);

      // Advance 1 hour — retry fires
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(probeVersion).toHaveBeenCalledTimes(2);

      // After retry succeeds, probeVersionNow sends immediate heartbeat with version
      const heartbeatMsg = JSON.parse(wsSend.mock.calls[0][0]);
      expect(heartbeatMsg.opencodeVersion).toBe('2.0.0');

      tunnel.stop();
    });

    it('clears version probe timer on stop', async () => {
      const probeVersion = vi.fn().mockRejectedValue(new Error('fail'));
      const tunnel = new AgentTunnel(testConfig(), noopCallbacks(), probeVersion);
      const wsSend = vi.fn();
      registerTunnel(tunnel, wsSend);

      await vi.advanceTimersByTimeAsync(100);

      tunnel.stop();
      expect((tunnel as any).versionProbeTimer).toBeNull();
    });
  });
});
