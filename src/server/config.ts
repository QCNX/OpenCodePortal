// ---------------------------------------------------------------------------
// Gateway — config loader
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import { parse as parseYaml } from 'yaml';
import { GatewayConfig, OidcConfig } from '../shared/types';
import { createLogger, Logger } from '../shared/logger';
import { substituteEnv } from '../shared/config';

const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];
export const DEFAULT_AGENT_IMAGE = 'ghcr.io/qcnx/opencode-portal-agent:latest';

/**
 * Parse + validate the optional `gateway.oidc` block.
 * Returns a normalized OidcConfig, or undefined when OIDC is not configured.
 * A partial/invalid block (missing required fields, or unresolved ${ENV})
 * is treated as "not configured" with a warning — the Gateway then falls back
 * to sharedSecret (or open) instead of crash-looping on a typo.
 */
function parseOidc(raw: any): OidcConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const required = ['issuer', 'clientId', 'clientSecret', 'redirectUri'] as const;
  const missing = required.filter((k) => {
    const v = raw[k];
    // Unsubstituted ${ENV} placeholders count as missing.
    return typeof v !== 'string' || v.trim() === '' || /^\$\{[^}]+\}$/.test(v);
  });

  if (missing.length > 0) {
    const log = createLogger('gateway');
    log.warn('config_load', 'oidc block ignored — missing/unresolved fields', { missing });
    return undefined;
  }

  const scopes = Array.isArray(raw.scopes) && raw.scopes.length > 0
    ? raw.scopes.map(String)
    : DEFAULT_OIDC_SCOPES;

  const sessionTtlHours = typeof raw.sessionTtlHours === 'number' && Number.isFinite(raw.sessionTtlHours) && raw.sessionTtlHours > 0
    ? raw.sessionTtlHours
    : undefined;

  return {
    issuer: raw.issuer,
    clientId: raw.clientId,
    clientSecret: raw.clientSecret,
    redirectUri: raw.redirectUri,
    scopes,
    ...(raw.allowInsecureIssuer === true ? { allowInsecureIssuer: true } : {}),
    ...(typeof raw.postLogoutRedirectUri === 'string' ? { postLogoutRedirectUri: raw.postLogoutRedirectUri } : {}),
    ...(sessionTtlHours !== undefined ? { sessionTtlHours } : {}),
  };
}

const DEFAULT_CONFIG: GatewayConfig = {
  gateway: {
    port: 8080,
    host: '0.0.0.0',
    baseDomain: 'localhost',
    agentImage: DEFAULT_AGENT_IMAGE,
  },
};

/**
 * Load gateway config from YAML file.
 * Environment variable substitution: ${VAR_NAME} in string values.
 */
export function loadConfig(configPath?: string): GatewayConfig {
  const resolvedPath = configPath || 'data/config.yaml';

  if (!fs.existsSync(resolvedPath)) {
    const log = createLogger('gateway');
    log.warn('config_load', 'config file not found — using defaults', { path: resolvedPath });
    return {
      gateway: {
        ...DEFAULT_CONFIG.gateway,
        agentImage: process.env.OCP_AGENT_IMAGE ?? DEFAULT_CONFIG.gateway.agentImage,
      },
    };
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const substituted = substituteEnv(raw);
  const parsed = parseYaml(substituted) ?? {};

  return {
    gateway: {
      port: parsed.gateway?.port ?? DEFAULT_CONFIG.gateway.port,
      host: parsed.gateway?.host ?? DEFAULT_CONFIG.gateway.host,
      baseDomain: parsed.gateway?.baseDomain ?? DEFAULT_CONFIG.gateway.baseDomain,
      agentImage: parsed.gateway?.agentImage ?? process.env.OCP_AGENT_IMAGE ?? DEFAULT_CONFIG.gateway.agentImage,
      sharedSecret: parsed.gateway?.sharedSecret ?? undefined,
      oidc: parseOidc(parsed.gateway?.oidc),
    },
  };
}
