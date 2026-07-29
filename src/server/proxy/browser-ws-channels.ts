import * as http from 'http';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import { InstanceRegistry } from '../registry';
import type { AgentTransport } from '../agent-transport';
import { nextChannelId, encodeWsTunnelPayload, decodeWsTunnelPayload } from '../../shared/protocol';
import { newTraceId, TRACE_HEADER } from '../../shared/trace';
import { createLogger, Logger } from '../../shared/logger';
import type { ChannelOpenedMessage, ChannelErrorMessage, ChannelClosedMessage } from '../../shared/types';
import { parseRequestHost } from '../http/host-routing';
import { stripQueryParam } from '../http/query';
import { AuthGate } from '../auth/gate';

const log: Logger = createLogger('gateway');
const MAX_ACTIVE_WS_CHANNELS = 1000;
const MAX_ACTIVE_WS_CHANNELS_PER_INSTANCE = 100;

export interface BrowserWsChannelsOptions {
  registry: InstanceRegistry;
  baseDomain: string;
  getTransport: () => AgentTransport | null;
  authGate: AuthGate;
}

export class BrowserWsChannels {
  private activeChannels = new Map<number, WebSocket>();
  private channelInstance = new Map<number, string>();
  private channelTraces = new Map<number, string>();
  private browserWss = new WebSocketServer({ noServer: true });

  constructor(private options: BrowserWsChannelsOptions) {}

  handleWsUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.options.authGate.authEnabled && !this.options.authGate.isAuthenticated(req)) {
      this.options.authGate.rejectWsUpgrade(socket);
      return;
    }

    const hostRoute = parseRequestHost(req.headers.host, this.options.baseDomain);
    if (hostRoute === null || hostRoute === 'apex') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const instance = this.options.registry.getBySubdomain(hostRoute.subdomain);
    if (!instance) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const instanceId = instance.id;
    const subPath = req.url || '/';
    const transport = this.options.getTransport();
    if (instance.status === 'offline' || !transport) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    const instanceChannelCount = Array.from(this.channelInstance.values()).filter((id) => id === instanceId).length;
    if (this.activeChannels.size >= MAX_ACTIVE_WS_CHANNELS || instanceChannelCount >= MAX_ACTIVE_WS_CHANNELS_PER_INSTANCE) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      log.warn('ws_channel_overload', 'too many active ws channels', {
        instanceId,
        activeChannels: this.activeChannels.size,
        instanceChannelCount,
      });
      return;
    }

    const channelId = nextChannelId();
    const traceId = newTraceId();

    this.browserWss.handleUpgrade(req, socket, head, (browserWs: WebSocket) => {
      this.activeChannels.set(channelId, browserWs);
      this.channelInstance.set(channelId, instanceId);
      this.channelTraces.set(channelId, traceId);
      log.info('ws_channel_open', 'ws channel opened', { channelId, instanceId, path: subPath }, traceId);

      const cleanPath = stripQueryParam(subPath, 'auth_token');

      const passthroughHeaders: Record<string, string> = {};
      passthroughHeaders[TRACE_HEADER] = traceId;

      const pwd = this.options.registry.getOpencodePassword(instanceId);
      if (pwd) {
        const user = this.options.registry.getOpencodeUser(instanceId) || 'opencode';
        passthroughHeaders['authorization'] =
          'Basic ' + Buffer.from(user + ':' + pwd).toString('base64');
      }

      transport.sendControlToAgent(instanceId, {
        type: 'channel_open',
        channelId,
        path: cleanPath,
        headers: passthroughHeaders,
      });

      browserWs.on('message', (data: Buffer | string, isBinary: boolean) => {
        const activeTransport = this.options.getTransport();
        if (!activeTransport) return;
        const buf = typeof data === 'string' ? Buffer.from(data) : data;
        activeTransport.sendToAgent(
          instanceId,
          channelId,
          encodeWsTunnelPayload(buf, isBinary),
        );
      });

      browserWs.on('close', () => {
        this.activeChannels.delete(channelId);
        this.channelInstance.delete(channelId);
        this.channelTraces.delete(channelId);
        this.options.getTransport()?.sendControlToAgent(instanceId, { type: 'channel_close', channelId });
        log.info('ws_channel_close', 'ws channel closed by browser', { channelId, instanceId }, traceId);
      });

      browserWs.on('error', (err: Error) => {
        log.error('ws_channel_error', 'ws channel error', { channelId, instanceId, error: err.message }, traceId);
        this.activeChannels.delete(channelId);
        this.channelInstance.delete(channelId);
        this.channelTraces.delete(channelId);
        this.options.getTransport()?.sendControlToAgent(instanceId, { type: 'channel_close', channelId });
      });
    });
  }

  forwardAgentData(requestId: number, payload: Buffer): boolean {
    const browserWs = this.activeChannels.get(requestId);
    if (!browserWs || browserWs.readyState !== WebSocket.OPEN) return false;

    const decoded = decodeWsTunnelPayload(payload);
    if (!decoded) return true;
    if (decoded.isBinary) {
      browserWs.send(decoded.data, { binary: true });
    } else {
      browserWs.send(decoded.data.toString('utf8'));
    }
    return true;
  }

  handleAgentChannelEvent(
    msg: ChannelOpenedMessage | ChannelErrorMessage | ChannelClosedMessage,
  ): void {
    const channelId = msg.channelId;
    const browserWs = this.activeChannels.get(channelId);
    const traceId = this.channelTraces.get(channelId);

    switch (msg.type) {
      case 'channel_opened':
        log.info('ws_channel_confirmed', 'agent confirmed ws channel', { channelId }, traceId);
        break;

      case 'channel_error':
        log.error('ws_channel_error', 'agent ws channel error', { channelId, error: msg.message }, traceId);
        this.channelTraces.delete(channelId);
        if (browserWs) {
          browserWs.close(1011, msg.message);
          this.activeChannels.delete(channelId);
          this.channelInstance.delete(channelId);
        }
        break;

      case 'channel_closed':
        log.info('ws_channel_closed', 'agent closed ws channel', { channelId }, traceId);
        this.channelTraces.delete(channelId);
        if (browserWs) {
          browserWs.close(1000, 'agent closed');
          this.activeChannels.delete(channelId);
          this.channelInstance.delete(channelId);
        }
        break;
    }
  }

  cleanupInstanceChannels(instanceId: string): void {
    for (const [channelId, instId] of this.channelInstance) {
      if (instId !== instanceId) continue;
      const ws = this.activeChannels.get(channelId);
      const traceId = this.channelTraces.get(channelId);
      if (ws) {
        ws.close(1000, 'agent disconnected');
      }
      this.activeChannels.delete(channelId);
      this.channelInstance.delete(channelId);
      this.channelTraces.delete(channelId);
      log.info('ws_channel_cleanup', 'cleaned up ws channel on agent disconnect', { channelId, instanceId }, traceId);
    }
  }
}
