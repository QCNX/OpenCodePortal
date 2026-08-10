// ---------------------------------------------------------------------------
// Agent — config loader
// ---------------------------------------------------------------------------
//
// Supports dual-mode:
//   1. Env vars only: AGENT_REGISTRATION_TOKEN, AGENT_TARGET_HOST, AGENT_TARGET_PORT, GATEWAY_URL
//   2. YAML file (optional): agent.config.yaml with same fields
// No legacy fallbacks (AGENT_TOKEN, LOCAL_PORT, AGENT_LOCAL_HOST removed per ADR 0001).
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { AgentConfig, AGENT_STATE_FILE, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS, HEARTBEAT_INTERVAL_MS, DEFAULT_AGENT_MAX_SOCKETS } from '../shared/types';
import { stripJsoncComments, chmodIfPossible } from '../shared/state';
import { createLogger, Logger } from '../shared/logger';
import { substituteEnv } from '../shared/config';

const log: Logger = createLogger('agent');

const DEFAULT_CONFIG: AgentConfig = {
  gateway: {
    url: 'ws://localhost:8080/agent/connect',
  },
  registrationToken: '',
  instanceId: '',
  targetHost: '127.0.0.1',
  targetPort: 4096,
  reconnect: {
    baseDelayMs: RECONNECT_BASE_DELAY_MS,
    maxDelayMs: RECONNECT_MAX_DELAY_MS,
  },
  heartbeat: {
    intervalMs: HEARTBEAT_INTERVAL_MS,
  },
  maxSockets: DEFAULT_AGENT_MAX_SOCKETS,
};

/**
 * Load agent config from YAML file, with environment variable substitution.
 * Falls back to defaults for missing fields.
 */
export function loadConfig(configPath?: string): AgentConfig {
  const resolvedPath = configPath || findDefaultConfigPath();

  let fileConfig: Partial<AgentConfig> = {};
  if (fs.existsSync(resolvedPath)) {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    fileConfig = parseYaml(substituteEnv(raw)) ?? {};
  }

  const merged: AgentConfig = {
    gateway: {
      url: fileConfig.gateway?.url || process.env.GATEWAY_URL || DEFAULT_CONFIG.gateway.url,
    },
    registrationToken: fileConfig.registrationToken || process.env.AGENT_REGISTRATION_TOKEN || '',
    instanceId: fileConfig.instanceId || process.env.AGENT_INSTANCE_ID || '',
    targetHost: fileConfig.targetHost || process.env.AGENT_TARGET_HOST || DEFAULT_CONFIG.targetHost,
    targetPort: fileConfig.targetPort || (process.env.AGENT_TARGET_PORT ? parseInt(process.env.AGENT_TARGET_PORT, 10) : 0) || DEFAULT_CONFIG.targetPort,
    reconnect: {
      baseDelayMs: fileConfig.reconnect?.baseDelayMs ?? DEFAULT_CONFIG.reconnect.baseDelayMs,
      maxDelayMs: fileConfig.reconnect?.maxDelayMs ?? DEFAULT_CONFIG.reconnect.maxDelayMs,
    },
    heartbeat: {
      intervalMs: fileConfig.heartbeat?.intervalMs ?? DEFAULT_CONFIG.heartbeat.intervalMs,
    },
    maxSockets: (() => {
      const fromFile = fileConfig.maxSockets;
      if (typeof fromFile === 'number' && fromFile > 0) return fromFile;
      const fromEnv = process.env.AGENT_MAX_SOCKETS;
      if (fromEnv) {
        const parsed = parseInt(fromEnv, 10);
        if (parsed > 0) return parsed;
      }
      return DEFAULT_CONFIG.maxSockets!;
    })(),
  };

  // Validate targetHost
  if (merged.targetHost !== 'localhost' && merged.targetHost !== '127.0.0.1' && !merged.targetHost.includes('.')) {
    log.warn('config_load', 'targetHost is not an IP, localhost, or hostname — connections may fail', { targetHost: merged.targetHost });
  }

  if (!merged.registrationToken) {
    log.error('config_load', 'no registration token configured — set AGENT_REGISTRATION_TOKEN');
    process.exit(1);
  }

  return merged;
}

/** Try loading saved agent state (instanceId + token) from data directory */
export function loadAgentState(dataDir?: string | null): { instanceId: string; token: string } | null {
  const dir = dataDir || process.env.PORTAL_DATA_DIR || path.join(process.cwd(), 'data');
  const filePath = path.join(dir, AGENT_STATE_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stripped = stripJsoncComments(raw);
    return JSON.parse(stripped) as { instanceId: string; token: string };
  } catch {
    return null;
  }
}

/** Save agent state (instanceId + token) to data directory */
export function saveAgentState(instanceId: string, token: string, dataDir?: string | null): void {
  const dir = dataDir || process.env.PORTAL_DATA_DIR || path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  chmodIfPossible(dir, 0o700, log);
  const filePath = path.join(dir, AGENT_STATE_FILE);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ instanceId, token }, null, 2) + '\n', 'utf8');
  chmodIfPossible(tmp, 0o600, log);
  fs.renameSync(tmp, filePath);
  chmodIfPossible(filePath, 0o600, log);
}

function findDefaultConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const homePath = path.join(home, '.opencode-portal', 'config.yaml');
  if (fs.existsSync(homePath)) return homePath;
  return path.join(process.cwd(), 'agent.config.yaml');
}
