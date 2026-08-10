// ---------------------------------------------------------------------------
// Gateway — instance registry (in-memory + persistence-backed)
// ---------------------------------------------------------------------------
//
// Single source of truth for all instances (ADR 0001 decision 1).
// Token verification lives here (ADR 0001 decision 4).
// State is hydrated from persistence on startup and persisted on mutation.
//
// Domain data (RegistryEntry) is kept separate from live connection
// bookkeeping (ConnectionState): connection state is never persisted and
// exists only for the lifetime of an Agent tunnel.
// ---------------------------------------------------------------------------

import { randomBytes } from 'crypto';
import { Instance, InstanceStatus, TokenVerifyResult, TOKEN_PREFIX } from '../shared/types';
import type { StateStore } from '../shared/state';
import { validateInstanceId, validateInstanceName } from '../shared/state';
import { createLogger, Logger } from '../shared/logger';

const log: Logger = createLogger('gateway');

/** PATCH: undefined = omit, null = clear, string = set (empty string clears). */
type ClearableString = string | null | undefined;

function applyClearableUpdate(
  current: string | undefined,
  value: ClearableString,
): string | undefined {
  if (value === undefined) return current;
  if (value === null) return undefined;
  return value || undefined;
}

function normalizeClearableForCreate(value: ClearableString): string | undefined {
  if (value == null) return undefined;
  return value || undefined;
}

/** Per-instance domain data (persisted). Holds no live connection state. */
interface RegistryEntry {
  instance: Instance;
  /** Per-instance token (ocp-at-*) */
  assignedToken: string;
  /** Instance target for Agent forwarding */
  targetHost?: string;
  targetPort?: number;
  /** OpenCode Server Basic Auth */
  opencodeUser?: string;
  opencodePassword?: string;
  /** Last known Agent IP */
  agentIp?: string;
}

/** Live tunnel connection bookkeeping — separate from domain data. */
interface ConnectionState {
  /** The WSS WebSocket for this Agent's tunnel connection */
  ws: import('ws').WebSocket | null;
  /** Timer for heartbeat timeout */
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
}

export class InstanceRegistry {
  private entries = new Map<string, RegistryEntry>();
  private subdomainIndex = new Map<string, string>();
  /** token → instanceId (kept in sync with create/hydrate/remove) */
  private tokenIndex = new Map<string, string>();
  /** Live connections keyed by instanceId — never persisted. */
  private connections = new Map<string, ConnectionState>();
  private stateStore: StateStore;

  /** Callback for persisting state on mutation */
  private onPersist?: () => void;
  /** Injected once (e.g. by TunnelServer); fired when a connection's heartbeat times out. */
  private onHeartbeatTimeout?: (instanceId: string, ws: import('ws').WebSocket) => void;

  constructor() {
    // stateStore is set via hydrate() before any operations
    this.stateStore = null!;
  }

  /**
   * Hydrate the registry from a state store.
   * Must be called once before any other operations.
   */
  hydrate(store: StateStore): void {
    this.stateStore = store;
    const state = store.load();

    this.entries.clear();
    this.subdomainIndex.clear();
    this.tokenIndex.clear();
    this.connections.clear();

    for (const [id, inst] of Object.entries(state.instances)) {
      this.subdomainIndex.set(id, id);
      this.entries.set(id, {
        instance: {
          id,
          name: inst.name,
          tags: inst.tags ?? [],
          status: 'offline',
          sessionCount: 0,
          lastSeen: 0,
          connectedAt: 0,
        },
        assignedToken: inst.assignedToken,
        targetHost: inst.targetHost,
        targetPort: inst.targetPort,
        opencodeUser: inst.opencodeUser,
        opencodePassword: inst.opencodePassword,
        agentIp: inst.agentIp,
      });
      // First entry wins if persisted tokens collide (matches old linear-scan order)
      if (!this.tokenIndex.has(inst.assignedToken)) {
        this.tokenIndex.set(inst.assignedToken, id);
      }
    }

    log.info('registry_hydrate', 'registry hydrated from state', {
      instances: this.entries.size,
    });
  }

  /**
   * Set a callback that fires on every mutation so the caller can persist.
   */
  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  /**
   * Inject the heartbeat-timeout handler once (replaces any previous).
   * Called with the instanceId and the ws that owned the expired timer.
   */
  setHeartbeatTimeoutHandler(cb: (instanceId: string, ws: import('ws').WebSocket) => void): void {
    this.onHeartbeatTimeout = cb;
  }

  // -----------------------------------------------------------------------
  // Token verification (per-instance tokens only)
  // -----------------------------------------------------------------------

  verifyToken(token: string): TokenVerifyResult {
    const instanceId = this.tokenIndex.get(token);
    if (instanceId !== undefined && this.entries.has(instanceId)) {
      return { valid: true, instanceId };
    }

    return { valid: false, reason: 'unknown_token' };
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** Create a new instance. Returns null on success, error string on failure. */
  create(id: string, name: string, tags: string[], opts?: { targetHost?: string; targetPort?: number; opencodeUser?: ClearableString; opencodePassword?: ClearableString }): string | null {
    const idErr = validateInstanceId(id);
    if (idErr) return idErr;
    const nameErr = validateInstanceName(name);
    if (nameErr) return nameErr;

    if (this.entries.has(id)) return 'Instance ID already exists';
    if (this.subdomainIndex.has(id)) return 'Subdomain already mapped';

    const token = this.generateInstanceToken();

    this.subdomainIndex.set(id, id);
    this.entries.set(id, {
      instance: {
        id,
        name,
        tags,
        status: 'offline',
        sessionCount: 0,
        lastSeen: 0,
        connectedAt: 0,
      },
      assignedToken: token,
      targetHost: opts?.targetHost,
      targetPort: opts?.targetPort,
      opencodeUser: normalizeClearableForCreate(opts?.opencodeUser),
      opencodePassword: normalizeClearableForCreate(opts?.opencodePassword),
    });
    this.tokenIndex.set(token, id);

    log.info('instance_created', 'instance created', { instanceId: id, name });
    this.onPersist?.();
    return null;
  }

  /** Update an instance's metadata. Returns null on success, error on failure. */
  update(id: string, updates: { name?: string; tags?: string[]; targetHost?: string; targetPort?: number; opencodeUser?: ClearableString; opencodePassword?: ClearableString }): string | null {
    const entry = this.entries.get(id);
    if (!entry) return 'Instance not found';

    if (updates.name !== undefined) {
      const err = validateInstanceName(updates.name);
      if (err) return err;
      entry.instance.name = updates.name;
    }
    if (updates.tags !== undefined) {
      entry.instance.tags = updates.tags;
    }
    if (updates.opencodePassword !== undefined) {
      entry.opencodePassword = applyClearableUpdate(entry.opencodePassword, updates.opencodePassword);
    }
    if (updates.targetHost !== undefined) {
      entry.targetHost = updates.targetHost || undefined;
    }
    if (updates.targetPort !== undefined) {
      entry.targetPort = updates.targetPort || undefined;
    }
    if (updates.opencodeUser !== undefined) {
      entry.opencodeUser = applyClearableUpdate(entry.opencodeUser, updates.opencodeUser);
    }

    this.onPersist?.();
    return null;
  }

  /** Remove an instance. Closes its WS connection with code 4003. */
  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const conn = this.connections.get(id);
    // Close agent connection with 4003 (Portainer Edge Agent pattern: stop reconnect, no exit)
    if (conn?.ws && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.close(4003, 'instance deleted');
    }
    if (conn?.heartbeatTimer) {
      clearTimeout(conn.heartbeatTimer);
    }

    // Only drop the index entry if it still maps to the removed instance —
    // with a hand-edited state.jsonc a duplicate token may index a different
    // instance (hydrate is first-wins); deleting unconditionally would strand it.
    if (this.tokenIndex.get(entry.assignedToken) === id) {
      this.tokenIndex.delete(entry.assignedToken);
    }
    this.connections.delete(id);
    this.entries.delete(id);
    this.subdomainIndex.delete(id);

    log.info('instance_deleted', 'instance removed', { instanceId: id });
    this.onPersist?.();
    return true;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /** Register an Agent's tunnel connection. Overwrites any existing connection. */
  register(
    instanceId: string,
    ws: import('ws').WebSocket,
    heartbeatTimeoutMs: number,
  ): boolean {
    const entry = this.entries.get(instanceId);
    if (!entry) {
      return false; // unknown instance — caller must create first
    }

    let conn = this.connections.get(instanceId);
    if (!conn) {
      conn = { ws: null, heartbeatTimer: null };
      this.connections.set(instanceId, conn);
    }

    // Close old connection if exists
    if (conn.ws && conn.ws !== ws && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.close(1000, 'superseded by new connection');
    }

    conn.ws = ws;
    entry.instance.status = 'online';
    entry.instance.lastSeen = Date.now();
    entry.instance.connectedAt = Date.now();

    // Reset heartbeat timer
    this.resetHeartbeat(entry, conn, heartbeatTimeoutMs);

    // Handle disconnect
    ws.on('close', () => {
      if (conn.ws === ws) {
        conn.ws = null;
        entry.instance.status = 'offline';
        entry.instance.connectedAt = 0;
        entry.instance.sessionCount = 0;
        if (conn.heartbeatTimer) {
          clearTimeout(conn.heartbeatTimer);
          conn.heartbeatTimer = null;
        }
        log.info('instance_disconnect', 'instance disconnected', { instanceId });
      }
    });

    return true;
  }

  /** Handle heartbeat from Agent — reset the timeout timer. Returns true when sessionCount changed or opencodeVersion changed. */
  heartbeat(
    instanceId: string,
    sessionCount: number,
    timeoutMs: number,
    opencodeVersion?: string,
  ): boolean {
    const entry = this.entries.get(instanceId);
    if (!entry) return false;

    let conn = this.connections.get(instanceId);
    if (!conn) {
      // Defensive: in the tunnel flow register() always precedes heartbeat(),
      // so conn.ws is non-null whenever the timeout timer arms. Keep the
      // branch — a future caller must not "simplify" it into dropping the
      // ws guard in resetHeartbeat.
      conn = { ws: null, heartbeatTimer: null };
      this.connections.set(instanceId, conn);
    }

    let changed = entry.instance.sessionCount !== sessionCount;
    entry.instance.sessionCount = sessionCount;
    entry.instance.lastSeen = Date.now();
    entry.instance.status = 'online';
    this.resetHeartbeat(entry, conn, timeoutMs);

    if (opencodeVersion !== undefined && entry.instance.opencodeVersion !== opencodeVersion) {
      entry.instance.opencodeVersion = opencodeVersion;
      changed = true;
    }

    return changed;
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  getWs(instanceId: string): import('ws').WebSocket | null {
    return this.connections.get(instanceId)?.ws ?? null;
  }

  get(instanceId: string): Instance | undefined {
    return this.entries.get(instanceId)?.instance;
  }

  getBySubdomain(subdomain: string): Instance | undefined {
    const id = this.subdomainIndex.get(subdomain);
    if (!id) return undefined;
    return this.get(id);
  }

  /** Get per-instance token for an instance */
  getAssignedToken(instanceId: string): string | undefined {
    return this.entries.get(instanceId)?.assignedToken;
  }

  /** Get opencodePassword for proxy injection */
  getOpencodePassword(instanceId: string): string | undefined {
    return this.entries.get(instanceId)?.opencodePassword;
  }

  /** Get target host/port for deploy instructions */
  getTargetHost(instanceId: string): string | undefined {
    return this.entries.get(instanceId)?.targetHost;
  }
  getTargetPort(instanceId: string): number | undefined {
    return this.entries.get(instanceId)?.targetPort;
  }
  getOpencodeUser(instanceId: string): string | undefined {
    return this.entries.get(instanceId)?.opencodeUser;
  }

  setAgentIp(instanceId: string, ip: string): void {
    const entry = this.entries.get(instanceId);
    if (entry) {
      entry.agentIp = ip;
      this.onPersist?.();
    }
  }

  /** Set Agent build version (runtime only — not persisted). */
  setAgentVersion(instanceId: string, version: string): void {
    const entry = this.entries.get(instanceId);
    if (entry) {
      entry.instance.agentVersion = version;
    }
  }

  /** Set upstream OpenCode version (runtime only — not persisted). */
  setOpencodeVersion(instanceId: string, version: string): void {
    const entry = this.entries.get(instanceId);
    if (entry) {
      entry.instance.opencodeVersion = version;
    }
  }

  list(): Instance[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e.instance }));
  }

  /** Build state snapshot for persistence */
  toPersistState(): Record<string, { name: string; tags: string[]; assignedToken: string; targetHost?: string; targetPort?: number; opencodeUser?: string; opencodePassword?: string; agentIp?: string }> {
    const result: Record<string, { name: string; tags: string[]; assignedToken: string; targetHost?: string; targetPort?: number; opencodeUser?: string; opencodePassword?: string; agentIp?: string }> = {};
    for (const [id, entry] of this.entries) {
      const inst: { name: string; tags: string[]; assignedToken: string; targetHost?: string; targetPort?: number; opencodeUser?: string; opencodePassword?: string; agentIp?: string } = {
        name: entry.instance.name,
        tags: entry.instance.tags,
        assignedToken: entry.assignedToken,
      };
      if (entry.targetHost) inst.targetHost = entry.targetHost;
      if (entry.targetPort) inst.targetPort = entry.targetPort;
      if (entry.opencodeUser) inst.opencodeUser = entry.opencodeUser;
      if (entry.opencodePassword) inst.opencodePassword = entry.opencodePassword;
      if (entry.agentIp) inst.agentIp = entry.agentIp;
      result[id] = inst;
    }
    return result;
  }

  // -- private ---------------------------------------------------------------

  private generateInstanceToken(): string {
    return TOKEN_PREFIX + randomBytes(16).toString('hex');
  }

  private resetHeartbeat(
    entry: RegistryEntry,
    conn: ConnectionState,
    timeoutMs: number,
  ): void {
    if (conn.heartbeatTimer) {
      clearTimeout(conn.heartbeatTimer);
      conn.heartbeatTimer = null;
    }
    const ws = conn.ws;
    conn.heartbeatTimer = setTimeout(() => {
      entry.instance.status = 'offline';
      entry.instance.connectedAt = 0;
      log.warn('instance_timeout', 'instance heartbeat timeout', { instanceId: entry.instance.id });
      if (ws && this.onHeartbeatTimeout) {
        this.onHeartbeatTimeout(entry.instance.id, ws);
      }
    }, timeoutMs);
  }
}
