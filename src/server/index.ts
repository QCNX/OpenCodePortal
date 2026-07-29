// ---------------------------------------------------------------------------
// Gateway — entry point
// ---------------------------------------------------------------------------
//
// Usage: tsx src/server/index.ts [data/config.yaml]
//        node dist/server/index.js [data/config.yaml]
// ---------------------------------------------------------------------------

import * as http from 'http';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { randomBytes } from 'crypto';

import { loadDotEnv } from '../shared/dotenv';
import { loadConfig } from './config';
import { InstanceRegistry } from './registry';
import { TunnelServer } from './tunnel';
import { Router } from './router';
import { OidcClient } from './auth/oidc-client';
import { JsoncStateStore } from '../shared/state';
import type { PersistenceState } from '../shared/types';
import { createLogger, Logger } from '../shared/logger';

const log: Logger = createLogger('gateway');

// -- Data directory -----------------------------------------------------------

const DATA_DIR = process.env.PORTAL_DATA_DIR || path.join(process.cwd(), 'data');

// -- State persistence (ADR 0001 decision 2) ----------------------------------

function loadOrCreateState(): { state: PersistenceState; store: JsoncStateStore; gatewayId: string; cookieSecret: string } {
  const store = new JsoncStateStore(DATA_DIR);
  let state = store.load();
  let changed = false;

  // Auto-generate gatewayId if missing
  if (!state.gatewayId) {
    state.gatewayId = randomUUID();
    changed = true;
  }

  // Auto-generate cookie signing key on first start (or if missing after migration)
  let cookieSecret = state.cookieSecret;
  if (!cookieSecret) {
    cookieSecret = randomBytes(32).toString('base64');
    state.cookieSecret = cookieSecret;
    changed = true;
  }
  if (changed) {
    store.save(state);
  }

  log.info('state_load', 'state loaded', {
    gatewayId: state.gatewayId,
    instances: Object.keys(state.instances).length,
  });

  return {
    state,
    store,
    gatewayId: state.gatewayId,
    cookieSecret,
  };
}

// -- Main --------------------------------------------------------------------

loadDotEnv();

const configPath = process.argv[2];
const config = loadConfig(configPath);
const { state, store, gatewayId, cookieSecret } = loadOrCreateState();

log.info('config_load', 'starting gateway', {
  host: config.gateway.host,
  port: config.gateway.port,
  instances: Object.keys(state.instances).length,
  gatewayId,
  authMode: config.gateway.oidc ? 'oidc' : config.gateway.sharedSecret ? 'sharedSecret' : 'none',
});

// Initialize registry from persistent state
const registry = new InstanceRegistry();
registry.hydrate(store);

// Wire auto-persistence on mutation
registry.setPersistCallback(() => {
  const persistState: PersistenceState = {
    gatewayId,
    cookieSecret,
    instances: registry.toPersistState(),
  };
  store.save(persistState);
});

// Create router
const router = new Router(
  registry,
  config.gateway.sharedSecret,
  config.gateway.baseDomain,
  config.gateway.port,
  cookieSecret,
  config.gateway.agentImage,
);

// Initialize OIDC if configured
let oidcClient: OidcClient | null = null;
if (config.gateway.oidc) {
  const OIDC_INIT_TIMEOUT_MS = 5 * 60 * 1000;
  const initStart = Date.now();
  const client = new OidcClient();
  oidcClient = client;
  const oidcCfg = config.gateway.oidc;
  const baseUrl = oidcCfg.redirectUri.replace(/\/auth\/callback$/, '');
  // Enable the OIDC gate before discovery so an unavailable IdP never opens
  // an OIDC-only gateway. Until initialization succeeds, login will fail
  // closed while health checks remain public.
  router.setOidcClient(client);

  const initOidc = (attempt: number): void => {
    // Already succeeded — nothing to do
    if (client.isConfigured()) return;

    const elapsed = Date.now() - initStart;
    if (elapsed > OIDC_INIT_TIMEOUT_MS) {
      log.error('config_load', 'oidc init timed out — gateway remains fail-closed', { elapsedMs: elapsed });
      return;
    }

    client.init(oidcCfg, baseUrl, config.gateway.baseDomain)
      .then(() => {
        log.info('config_load', 'oidc ready — authentication enabled');
      })
      .catch((err) => {
        const delayMs = Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
        log.error('config_load', 'oidc init failed — will retry', {
          error: err.message, attempt, retryInMs: delayMs,
        });
        log.warn('config_load', 'oidc init failed — gateway remains fail-closed until retry succeeds');
        setTimeout(() => initOidc(attempt + 1), delayMs).unref();
      });
  };
  initOidc(0);
}

// Create tunnel server (no longer needs GatewayConfig)
const tunnel = new TunnelServer(registry, {
  onAgentData(instanceId, requestId, payload) {
    router.handleAgentData(instanceId, requestId, payload);
  },
  onAgentChannelEvent(instanceId, msg) {
    router.handleAgentChannelEvent(instanceId, msg);
  },
  onAgentDisconnect(instanceId) {
    router.cleanupInstanceChannels(instanceId);
    router.cleanupInstanceRequests(instanceId);
    router.broadcastDashboardUpdate();
  },
  onInstanceMetricsUpdate() {
    router.broadcastDashboardUpdate();
  },
}, gatewayId);

// Wire up — proxy modules depend only on the Agent transport contract.
router.setTransport(tunnel);

// Create HTTP server
const server = http.createServer((req, res) => {
  router.handleRequest(req, res);
});

// Attach WebSocket server (shared HTTP server)
tunnel.attach(server);

// Route WebSocket upgrades: agent → tunnel, proxy → router
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/agent/connect') {
    tunnel.handleWsUpgrade(req, socket, head);
    return;
  }
  router.handleWsUpgrade(req, socket, head);
});

// Start listening
server.listen(config.gateway.port, config.gateway.host, () => {
  log.info('server_start', 'gateway listening', { host: config.gateway.host, port: config.gateway.port, gatewayId });
});

// Graceful shutdown (idempotent — ignores repeated signals)
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server_shutdown', 'shutting down gateway');
  for (const inst of registry.list()) {
    if (inst.status === 'online') {
      tunnel.sendControlToAgent(inst.id, { type: 'shutdown' } as any);
      const ws = registry.getWs(inst.id);
      if (ws) {
        ws.close(1000, 'gateway shutdown');
      }
    }
  }
  // Final state save
  const persistState: PersistenceState = {
    gatewayId,
    cookieSecret,
    instances: registry.toPersistState(),
  };
  store.save(persistState);

  server.close(() => {
    log.info('server_shutdown', 'shutdown complete');
    process.exit(0);
  });
  // Force exit if connections hang (e.g. stale agent WSS)
  setTimeout(() => {
    log.warn('server_shutdown', 'forced exit after timeout');
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
