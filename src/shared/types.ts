// ---------------------------------------------------------------------------
// OpenCode Portal — shared types
// ---------------------------------------------------------------------------

/** Instance status */
export type InstanceStatus = 'online' | 'offline';

/** An instance (logical OpenCode Server) managed by Gateway */
export interface Instance {
  /** Unique instance id — also the DNS subdomain for routing */
  id: string;
  /** Human-readable display name */
  name: string;
  tags: string[];
  status: InstanceStatus;
  sessionCount: number;
  lastSeen: number; // timestamp ms
  /** Timestamp when the instance most recently came online (0 if never) */
  connectedAt: number;
  /** Agent build version reported on register (runtime only, not persisted) */
  agentVersion?: string;
  /** Upstream OpenCode Server version (runtime only, not persisted). Reported by Agent via heartbeat after probing /global/health. */
  opencodeVersion?: string;
}

// ---------------------------------------------------------------------------
// Control messages (JSON over WSS text frames)
// ---------------------------------------------------------------------------

export interface RegisterMessage {
  type: 'register';
  token: string;
  /** Optional: Agent self-identifies on reconnect (ADR 0001 decision 5) */
  instanceId?: string;
  /** Optional: Agent build version from package.json */
  agentVersion?: string;
}

export interface RegisteredMessage {
  type: 'registered';
  status: 'ok' | 'error';
  assignedId?: string;
  assignedToken?: string;
  gatewayId?: string;
  message?: string;
  /** WebSocket close code when status is 'error' (4001 token rejected, 4002 instance not found). */
  closeCode?: number;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  sessionCount: number;
  /** Optional: upstream OpenCode Server version discovered by Agent */
  opencodeVersion?: string;
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
}

/** Gateway → Agent: cancel an in-flight HTTP/SSE proxy request */
export interface RequestCancelMessage {
  type: 'request_cancel';
  requestId: number;
}

/** Gateway → Agent: open a WebSocket passthrough channel */
export interface ChannelOpenMessage {
  type: 'channel_open';
  channelId: number;
  path: string;
  /** Optional headers from the original browser upgrade request (Origin, Host, etc.) */
  headers?: Record<string, string>;
}

/** Agent → Gateway: channel opened successfully */
export interface ChannelOpenedMessage {
  type: 'channel_opened';
  channelId: number;
}

/** Agent → Gateway: channel open failed */
export interface ChannelErrorMessage {
  type: 'channel_error';
  channelId: number;
  message: string;
}

/** Bidirectional: close a channel */
export interface ChannelCloseMessage {
  type: 'channel_close';
  channelId: number;
}

/** Agent → Gateway: channel closed (acknowledgment) */
export interface ChannelClosedMessage {
  type: 'channel_closed';
  channelId: number;
}

export type ControlMessage =
  | RegisterMessage
  | RegisteredMessage
  | HeartbeatMessage
  | HeartbeatAckMessage
  | ErrorMessage
  | ShutdownMessage
  | RequestCancelMessage
  | ChannelOpenMessage
  | ChannelOpenedMessage
  | ChannelErrorMessage
  | ChannelCloseMessage
  | ChannelClosedMessage;

// ---------------------------------------------------------------------------
// Config shapes
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  gateway: {
    port: number;
    host: string;
    /** Apex domain for Dashboard; instances use `<id>.<baseDomain>` */
    baseDomain: string;
    /** Public or private Agent container image used in deploy instructions. */
    agentImage: string;
    sharedSecret?: string; // Phase 1 auth: Bearer token or ?token= query param
    oidc?: OidcConfig;     // Phase 2 OIDC SSO (optional, overrides sharedSecret for web)
  };
}

export interface OidcConfig {
  issuer: string;       // e.g. https://auth.example.com/application/o/opencode/
  clientId: string;
  clientSecret: string;
  redirectUri: string;  // e.g. https://gate.example.com/auth/callback
  scopes?: string[];    // default: ['openid', 'profile', 'email']
  /** Dev/test only: allow http:// OIDC issuer/discovery endpoints. Defaults to false. */
  allowInsecureIssuer?: boolean;
  /**
   * Browser session lifetime in hours. Unset → the session follows the IdP
   * access-token lifetime (`expires_in`); when set, this value wins.
   * Fallback when neither is available: 24h.
   */
  sessionTtlHours?: number;
  /** Reserved for RP-initiated logout (Phase: end_session). Unused while logout is local-only. */
  postLogoutRedirectUri?: string;
}

/**
 * Effective auth mode, derived once at startup:
 * - 'oidc'   → OIDC SSO is the sole browser login; sharedSecret form + cookie are masked,
 *              but Bearer / ?token= remain as a break-glass / API path.
 * - 'secret' → sharedSecret login form + SSO cookie + Bearer + ?token=.
 * - 'open'   → no auth enforced.
 */
export type AuthMode = 'oidc' | 'secret' | 'open';

export interface AgentConfig {
  gateway: {
    url: string; // ws:// or wss://
  };
  /** Per-instance registration token (ocp-at-*) for connecting to an existing instance */
  registrationToken: string;
  /** Instance id (filled after first registration; used for reconnection) */
  instanceId: string;
  /** OpenCode target hostname (validated: IP, localhost, or contains dot) */
  targetHost: string;
  /** OpenCode target port (default 4096) */
  targetPort: number;
  reconnect: {
    baseDelayMs: number;
    maxDelayMs: number;
  };
  heartbeat: {
    intervalMs: number;
  };
  /** Max concurrent upstream HTTP sockets (default 50). */
  maxSockets?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
export const DEFAULT_AGENT_MAX_SOCKETS = 50;

/** Prefix for per-instance tokens */
export const TOKEN_PREFIX = 'ocp-at-';
/** @deprecated Global registration tokens are no longer used. Use per-instance ocp-at-* tokens. */
export const GLOBAL_TOKEN_PREFIX = 'ocp-gr-';

/** State file names */
export const PERSISTENT_STATE_FILE = 'state.jsonc';
export const AGENT_STATE_FILE = 'agent-state.jsonc';

// ---------------------------------------------------------------------------
// Persistence state shape
// ---------------------------------------------------------------------------

export interface PersistenceState {
  gatewayId: string;
  /** @deprecated No longer generated or used. Kept for backward-compat with older state.jsonc files. */
  globalToken?: string;
  /** HMAC key for ocp_auth cookie signing. Regenerated if missing on startup. */
  cookieSecret?: string;
  instances: Record<string, PersistenceInstance>;
}

export interface PersistenceInstance {
  name: string;
  tags: string[];
  assignedToken: string;
  targetHost?: string;
  targetPort?: number;
  opencodeUser?: string;
  opencodePassword?: string;
  agentIp?: string;
}

/** Token verification result */
export interface TokenVerifyResult {
  valid: boolean;
  instanceId?: string;
  reason?: string;
}

/** Maximum proxy request/response body size (50 MiB) */
export const MAX_PROXY_REQUEST_BODY_BYTES = 50 * 1024 * 1024;
export const MAX_PROXY_RESPONSE_BODY_BYTES = 50 * 1024 * 1024;
