// ---------------------------------------------------------------------------
// Agent — entry point
// ---------------------------------------------------------------------------
//
// Usage: tsx src/agent/index.ts [agent.config.yaml]
//        node dist/agent/index.js [agent.config.yaml]
// ---------------------------------------------------------------------------

import { loadConfig, loadAgentState, saveAgentState } from './config';
import { AgentTunnel } from './tunnel';
import { Forwarder } from './forwarder';
import { createLogger, Logger } from '../shared/logger';

const log: Logger = createLogger('agent');

const configPath = process.argv[2];
const config = loadConfig(configPath);

// Try loading saved agent state for reconnect (ADR 0001 decision 5)
const savedState = loadAgentState();
if (savedState && !config.instanceId) {
  config.instanceId = savedState.instanceId;
  config.registrationToken = savedState.token;
  log.info('agent_start', 'loaded saved state', { instanceId: config.instanceId });
}

log.info('agent_start', 'starting agent', {
  gatewayUrl: config.gateway.url,
  targetHost: config.targetHost,
  targetPort: config.targetPort,
  instanceId: config.instanceId || '(will be assigned)',
  registrationToken: config.registrationToken.substring(0, 8) + '...',
});

const tunnel = new AgentTunnel(config, {
  onRegistered(assignedId, assignedToken, gatewayId) {
    log.info('agent_start', 'registration confirmed', { assignedId, gatewayId });
    // Persist the per-instance token for reconnection.
    const tokenToPersist = assignedToken || config.registrationToken;
    saveAgentState(assignedId, tokenToPersist);
    config.instanceId = assignedId;
    config.registrationToken = tokenToPersist;
  },
  onData(requestId, payload) {
    forwarder.handleRequest(requestId, payload);
  },
  onChannelOpen(channelId, path, headers) {
    forwarder.openChannel(channelId, path, headers);
  },
  onChannelClose(channelId) {
    forwarder.closeChannel(channelId);
  },
  onRequestCancel(requestId) {
    forwarder.cancelRequest(requestId);
  },
  onDisconnect() {
    forwarder.closeAllChannels();
    forwarder.cancelAllRequests();
  },
});

const forwarder = new Forwarder(config.targetPort, config.targetHost, tunnel, config.maxSockets);

// Graceful shutdown
process.on('SIGINT', () => {
  log.info('agent_shutdown', 'shutting down (SIGINT)');
  tunnel.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('agent_shutdown', 'terminated (SIGTERM)');
  tunnel.stop();
  process.exit(0);
});

tunnel.start();
