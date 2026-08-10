// ---------------------------------------------------------------------------
// Gateway — WSS tunnel server
// ---------------------------------------------------------------------------
//
// Accepts Agent WebSocket connections:
//   - Verifies agent token
//   - Registers the agent in the registry
//   - Manages control messages (heartbeat, etc.)
//   - Routes binary frames between browser requests and agents
// ---------------------------------------------------------------------------

import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { InstanceRegistry } from './registry';
import { ControlMessage, RegisterMessage, ChannelOpenMessage, ChannelCloseMessage, ChannelOpenedMessage, ChannelErrorMessage, ChannelClosedMessage, HEARTBEAT_TIMEOUT_MS } from '../shared/types';
import { tryParseControlMessage, encodeFrame, decodeFrame } from '../shared/protocol';
import { createLogger, Logger } from '../shared/logger';
import type { AgentTransport } from './agent-transport';

const log: Logger = createLogger('gateway');

export interface TunnelCallbacks {
  /** Called when binary frame arrives from Agent (response to forwarded request or WS channel data) */
  onAgentData: (instanceId: string, requestId: number, payload: Buffer) => void;
  /** Called when Agent sends a channel control event */
  onAgentChannelEvent: (instanceId: string, msg: ChannelOpenedMessage | ChannelErrorMessage | ChannelClosedMessage) => void;
  /** Called when a registered Agent disconnects */
  onAgentDisconnect: (instanceId: string) => void;
  /** Called when instance metrics (e.g. sessionCount) change */
  onInstanceMetricsUpdate?: (instanceId: string) => void;
}

export class TunnelServer implements AgentTransport {
  private wss: WebSocketServer | null = null;
  private gatewayId: string;

  constructor(
    private registry: InstanceRegistry,
    private callbacks: TunnelCallbacks,
    gatewayId: string,
    private heartbeatTimeoutMs: number = HEARTBEAT_TIMEOUT_MS,
  ) {
    this.gatewayId = gatewayId;
    // Heartbeat timeouts are injected once; the registry owns the timers.
    registry.setHeartbeatTimeoutHandler((id, ws) => this.handleHeartbeatTimeout(id, ws));
  }

  /** Create the WebSocket server (noServer mode — upgrades handled externally). */
  attach(server: import('http').Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      log.info('agent_connect', 'new agent connection', { remoteAddress: req.socket.remoteAddress });

      let instanceId: string | null = null;
      let registered = false;

      ws.on('message', (data: WebSocket.Data) => {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as string);

        // Text frames carry JSON control messages; anything else is a binary
        // frame (data forwarding from Agent → browser).
        const control = tryParseControlMessage(raw);
        if (control) {
          const newId = this.handleControl(ws, control, instanceId);
          if (newId) {
            instanceId = newId;
            registered = true;
          }
          return;
        }

        // Binary frame → data forwarding (response from Agent → browser)
        if (registered && instanceId) {
          const decoded = decodeFrame(raw);
          if (decoded) {
            this.callbacks.onAgentData(instanceId, decoded.requestId, decoded.payload);
          }
        }
      });

      ws.on('error', (err: Error) => {
        log.error('agent_error', 'agent connection error', { instanceId: instanceId || 'unregistered', error: err.message });
      });

      ws.on('close', () => {
        if (registered && instanceId) {
          log.info('agent_disconnect', 'agent disconnected', { instanceId });
          this.callbacks.onAgentDisconnect(instanceId);
        }
      });
    });

    log.info('tunnel_ready', 'websocket server ready');
  }

  /** Handle an HTTP upgrade request (called from index.ts upgrade handler). */
  handleWsUpgrade(req: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer): void {
    if (!this.wss) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req);
    });
  }

  /** Send a binary frame to a specific instance's Agent. */
  sendToAgent(instanceId: string, requestId: number, payload: Buffer): boolean {
    const ws = this.registry.getWs(instanceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(encodeFrame(requestId, payload));
    return true;
  }

  /** Send a control message to a specific instance's Agent. */
  sendControlToAgent(instanceId: string, msg: ControlMessage): void {
    const ws = this.registry.getWs(instanceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  // -- private ---------------------------------------------------------------

  private handleControl(
    ws: WebSocket,
    msg: ControlMessage,
    currentInstanceId: string | null,
  ): string | null {
    switch (msg.type) {
      case 'register': {
        const reg = msg as RegisterMessage;
        const result = this.registry.verifyToken(reg.token);

        if (!result.valid) {
          log.warn('token_rejected', 'unknown token from agent', { reason: result.reason });
          ws.send(JSON.stringify({
            type: 'registered',
            status: 'error',
            message: result.reason || 'unknown token',
            closeCode: 4001,
          }));
          ws.close(4001, 'unknown token');
          return null;
        }

        // Per-instance token always maps to exactly one instance.
        const tokenInstanceId = result.instanceId!;

        // If agent self-declares an instanceId (reconnect), verify it matches the token.
        if (reg.instanceId && reg.instanceId !== tokenInstanceId) {
          log.warn('token_rejected', 'token does not match declared instanceId', {
            declared: reg.instanceId,
            tokenBinding: tokenInstanceId,
          });
          ws.send(JSON.stringify({
            type: 'registered',
            status: 'error',
            message: 'token does not match instanceId',
            closeCode: 4001,
          }));
          ws.close(4001, 'token mismatch');
          return null;
        }

        const instanceId = reg.instanceId || tokenInstanceId;

        // Register the agent connection
        const registered = this.registry.register(
          instanceId,
          ws,
          this.heartbeatTimeoutMs,
        );

        if (!registered) {
          log.error('agent_register', 'instance not found in registry', { instanceId });
          ws.send(JSON.stringify({
            type: 'registered',
            status: 'error',
            message: 'instance not found',
            closeCode: 4002,
          }));
          ws.close(4002, 'instance not found');
          return null;
        }

        // Track agent IP
        const agentIp = (ws as any)._socket?.remoteAddress;
        if (agentIp) this.registry.setAgentIp(instanceId, agentIp);

        if (reg.agentVersion) this.registry.setAgentVersion(instanceId, reg.agentVersion);

        // Send success response with assignedId and per-instance token
        const assignedToken = this.registry.getAssignedToken(instanceId);
        ws.send(JSON.stringify({
          type: 'registered',
          status: 'ok',
          assignedId: instanceId,
          assignedToken: assignedToken,
          gatewayId: this.gatewayId,
        }));

        log.info('agent_register', 'agent registered', { instanceId, gatewayId: this.gatewayId });
        return instanceId;
      }

      case 'heartbeat': {
        if (!currentInstanceId) return currentInstanceId;
        const hb = msg as import('../shared/types').HeartbeatMessage;
        const sessionCount = hb.sessionCount;
        const changed = this.registry.heartbeat(
          currentInstanceId,
          sessionCount,
          this.heartbeatTimeoutMs,
          hb.opencodeVersion,
        );
        if (changed) {
          this.callbacks.onInstanceMetricsUpdate?.(currentInstanceId);
        }
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        return currentInstanceId;
      }

      case 'channel_opened':
      case 'channel_error':
      case 'channel_closed': {
        if (!currentInstanceId) return currentInstanceId;
        this.callbacks.onAgentChannelEvent(currentInstanceId, msg as any);
        return currentInstanceId;
      }

      default:
        return currentInstanceId;
    }
  }

  private handleHeartbeatTimeout(instanceId: string, ws: WebSocket): void {
    if (this.registry.getWs(instanceId) !== ws) return;
    log.warn('instance_timeout', 'agent heartbeat timeout', { instanceId });
    ws.close(1001, 'heartbeat timeout');
  }
}
