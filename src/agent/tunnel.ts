// ---------------------------------------------------------------------------
// Agent — WSS tunnel client
// ---------------------------------------------------------------------------
//
// Manages the WSS connection to Gateway:
//   - Connects to Gateway
//   - Sends register message with token
//   - Maintains heartbeat
//   - Forwards binary frames to forwarder callback
//   - Reconnects on disconnect with exponential backoff
//   - Stops reconnecting on 401 (token rejected)
// ---------------------------------------------------------------------------

import WebSocket from 'ws';
import { AgentConfig, ControlMessage, RegisteredMessage, ChannelOpenMessage, ChannelCloseMessage, RequestCancelMessage } from '../shared/types';
import { tryParseControlMessage, encodeFrame, decodeFrame } from '../shared/protocol';
import { createLogger, Logger } from '../shared/logger';
import { getPortalVersion } from '../shared/version';
import { probeOpencodeVersion } from './version-probe';

const log: Logger = createLogger('agent');

/** Debounce immediate heartbeat after sessionCount changes (ms). */
const SESSION_COUNT_HEARTBEAT_DEBOUNCE_MS = 1000;
/** Retry version probe interval after failure (ms). */
const VERSION_PROBE_RETRY_MS = 3_600_000; // 1 hour

export interface TunnelCallbacks {
  /** Called when binary frame data arrives to be forwarded to OpenCode */
  onData: (requestId: number, payload: Buffer) => void;
  /** Called when registration completes successfully */
  onRegistered: (assignedId: string, assignedToken: string | undefined, gatewayId: string) => void;
  /** Called when the tunnel is disconnected */
  onDisconnect: () => void;
  /** Called when Gateway requests a WS channel open */
  onChannelOpen: (channelId: number, path: string, headers?: Record<string, string>) => void;
  /** Called when Gateway requests a WS channel close */
  onChannelClose: (channelId: number) => void;
  /** Called when Gateway cancels an in-flight HTTP/SSE request */
  onRequestCancel: (requestId: number) => void;
}

export class AgentTunnel {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private debouncedHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private versionProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private registered = false;
  private stopped = false;
  private sessionCount = 0;
  private opencodeVersion?: string;

  constructor(
    private config: AgentConfig,
    private callbacks: TunnelCallbacks,
    private probeVersion: (host: string, port: number) => Promise<string | undefined> = probeOpencodeVersion,
  ) {
    this.reconnectDelay = config.reconnect.baseDelayMs;
  }

  /** Start the tunnel — connect and begin heartbeat. */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Graceful stop — close connection and clear timers. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'agent shutting down');
      this.ws = null;
    }
  }

  /** Update session count (called by forwarder when sessions change). */
  setSessionCount(count: number): void {
    if (count === this.sessionCount) return;
    this.sessionCount = count;
    this.scheduleDebouncedHeartbeat();
  }

  /** Send a binary frame to Gateway (for WS channel data). */
  sendBinary(requestId: number, payload: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = encodeFrame(requestId, payload);
    this.ws.send(frame);
  }

  /** Send a channel control message to Gateway. */
  sendChannelControl(msg: { type: string; channelId: number; message?: string }): void {
    this.sendControl(msg as any);
  }

  // -- private ---------------------------------------------------------------

  private connect(): void {
    if (this.stopped) return;

    log.info('agent_connect', 'connecting to gateway', { url: this.config.gateway.url });

    try {
      this.ws = new WebSocket(this.config.gateway.url);
    } catch (err) {
      log.error('agent_connect', 'failed to create websocket', { error: String(err) });
      this.scheduleReconnect();
      return;
    }

      this.ws.on('open', () => {
        log.info('agent_connect', 'connected, sending register');
        const msg: any = { type: 'register', token: this.config.registrationToken, agentVersion: getPortalVersion() };
        // Self-identify on reconnect (ADR 0001 decision 5)
        if (this.config.instanceId) {
          msg.instanceId = this.config.instanceId;
        }
        this.sendControl(msg);
      });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || '';
      log.info('agent_disconnect', 'disconnected', { code, reason: reasonStr });
      this.clearTimers();
      this.registered = false;
      this.callbacks.onDisconnect();

      // Token rejected, instance deleted → stop reconnecting permanently (Portainer Edge Agent pattern)
      if (code === 4001 || code === 4002 || code === 1008 || code === 4003) {
        log.error('token_rejected', 'permanent close code — stopping reconnect', { code });
        this.stopped = true;
        return;
      }

      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      log.error('agent_connect', 'websocket error', { error: err.message });
      // close event will fire after error, triggering reconnect
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as string);

    // Text frames carry JSON control messages; anything else is a binary
    // frame (data forwarding from Gateway → localhost).
    const control = tryParseControlMessage(raw);
    if (control) {
      this.handleControl(control);
      return;
    }

    // Binary frame → data forwarding
    const decoded = decodeFrame(raw);
    if (decoded) {
      this.callbacks.onData(decoded.requestId, decoded.payload);
    }
  }

  private handleControl(msg: ControlMessage): void {
    switch (msg.type) {
      case 'registered': {
        const reg = msg as RegisteredMessage;
        if (reg.status === 'ok' && reg.assignedId) {
          this.registered = true;
          this.reconnectDelay = this.config.reconnect.baseDelayMs; // reset backoff
          log.info('agent_register', 'registered with gateway', {
            assignedId: reg.assignedId,
            assignedToken: reg.assignedToken ? reg.assignedToken.substring(0, 7) + '...' : '(none)',
            gatewayId: reg.gatewayId,
          });
          this.callbacks.onRegistered(reg.assignedId, reg.assignedToken, reg.gatewayId || '');
          this.startHeartbeat();
          this.probeVersionNow();
        } else {
          const closeCode = reg.closeCode ?? 4002;
          log.error('agent_register', 'registration failed', { message: reg.message || 'unknown error', closeCode });
          this.ws?.close(closeCode, 'registration failed');
        }
        break;
      }
      case 'heartbeat_ack':
        break;
      case 'shutdown':
        log.info('agent_shutdown', 'gateway shutting down');
        this.stopped = true;
        this.ws?.close(1000, 'gateway shutdown');
        break;
      case 'channel_open': {
        const chOpen = msg as ChannelOpenMessage;
        log.info('channel_open_request', 'channel open requested', { channelId: chOpen.channelId, path: chOpen.path });
        this.callbacks.onChannelOpen(chOpen.channelId, chOpen.path, chOpen.headers);
        break;
      }
      case 'channel_close': {
        const chClose = msg as ChannelCloseMessage;
        log.info('channel_close_request', 'channel close requested', { channelId: chClose.channelId });
        this.callbacks.onChannelClose(chClose.channelId);
        break;
      }
      case 'request_cancel': {
        const cancel = msg as RequestCancelMessage;
        log.info('request_cancel', 'request cancel requested', { requestId: cancel.requestId });
        this.callbacks.onRequestCancel(cancel.requestId);
        break;
      }
      case 'error':
        log.error('gateway_error', 'gateway error', { message: msg.message });
        break;
    }
  }

  private sendControl(msg: ControlMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private sendHeartbeatNow(): void {
    const msg: any = { type: 'heartbeat', sessionCount: this.sessionCount };
    if (this.opencodeVersion) msg.opencodeVersion = this.opencodeVersion;
    this.sendControl(msg);
  }

  private scheduleDebouncedHeartbeat(): void {
    if (!this.registered || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.debouncedHeartbeatTimer) return;
    this.debouncedHeartbeatTimer = setTimeout(() => {
      this.debouncedHeartbeatTimer = null;
      this.sendHeartbeatNow();
    }, SESSION_COUNT_HEARTBEAT_DEBOUNCE_MS);
    this.debouncedHeartbeatTimer.unref?.();
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeatNow();
    }, this.config.heartbeat.intervalMs);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    log.info('reconnect_backoff', 'scheduling reconnect', { delay_ms: this.reconnectDelay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.config.reconnect.maxDelayMs,
      );
      this.connect();
    }, this.reconnectDelay);
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.debouncedHeartbeatTimer) {
      clearTimeout(this.debouncedHeartbeatTimer);
      this.debouncedHeartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.versionProbeTimer) {
      clearTimeout(this.versionProbeTimer);
      this.versionProbeTimer = null;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -- version probe ---------------------------------------------------------

  private probeVersionNow(): void {
    this.probeVersion(this.config.targetHost, this.config.targetPort)
      .then((version) => {
        if (version) {
          log.info('version_probe', 'upstream opencode version discovered', { version });
          this.opencodeVersion = version;
          // Send immediate heartbeat to report the new version
          this.sendHeartbeatNow();
        } else {
          this.scheduleVersionProbe();
        }
      })
      .catch(() => {
        this.scheduleVersionProbe();
      });
  }

  private scheduleVersionProbe(): void {
    if (this.stopped) return;
    // Clear any existing timer before scheduling a new one
    if (this.versionProbeTimer) {
      clearTimeout(this.versionProbeTimer);
      this.versionProbeTimer = null;
    }
    this.versionProbeTimer = setTimeout(() => {
      this.versionProbeTimer = null;
      if (this.registered && !this.stopped) {
        this.probeVersionNow();
      }
    }, VERSION_PROBE_RETRY_MS);
    this.versionProbeTimer.unref?.();
  }
}
