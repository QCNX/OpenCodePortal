// ---------------------------------------------------------------------------
// Gateway — instance registry (in-memory + persistence-backed)
// ---------------------------------------------------------------------------
//
// Single source of truth for all instances (ADR 0001 decision 1).
// Token verification lives here (ADR 0001 decision 4).
// State is hydrated from persistence on startup and persisted on mutation.
// ---------------------------------------------------------------------------

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

interface RegistryEntry {
  instance: Instance;
  /** The WSS WebSocket for this Agent's tunnel connection */
  ws: import('ws').WebSocket | null;
  /** Timer for heartbeat timeout */
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
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

export class InstanceRegistry {
  private entries = new Map<string, RegistryEntry>();
  private subdomainIndex = new Map<string, string>();
  private stateStore: StateStore;

  /** Callback for persisting state on mutation */
  private onPersist?: () => void;

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
        ws: null,
        heartbeatTimer: null,
        assignedToken: inst.assignedToken,
        targetHost: inst.targetHost,
        targetPort: inst.targetPort,
        opencodeUser: inst.opencodeUser,
        opencodePassword: inst.opencodePassword,
        agentIp: inst.agentIp,
      });
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

  // -----------------------------------------------------------------------
  // Token verification (per-instance tokens only)
  // -----------------------------------------------------------------------

  verifyToken(token: string): TokenVerifyResult {
    // Per-instance token (ocp-at-*) — must match an existing instance
    for (const [id, entry] of this.entries) {
      if (entry.assignedToken === token) {
        return { valid: true, instanceId: id };
      }
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

    const token = this.stateStore.generateInstanceToken();

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
      ws: null,
      heartbeatTimer: null,
      assignedToken: token,
      targetHost: opts?.targetHost,
      targetPort: opts?.targetPort,
      opencodeUser: normalizeClearableForCreate(opts?.opencodeUser),
      opencodePassword: normalizeClearableForCreate(opts?.opencodePassword),
    });

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

    // Close agent connection with 4003 (Portainer Edge Agent pattern: stop reconnect, no exit)
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.close(4003, 'instance deleted');
    }
    if (entry.heartbeatTimer) {
      clearTimeout(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }

    this.entries.delete(id);
    this.subdomainIndex.delete(id);

    log.info('instance_deleted', 'instance removed', { instanceId: id });
    this.onPersist?.();
    return true;
  }

  // -----------------------------------------------------------------------
  // Registration (unchanged core logic)
  // -----------------------------------------------------------------------

  /** Register an Agent's tunnel connection. Overwrites any existing connection. */
  register(
    instanceId: string,
    ws: import('ws').WebSocket,
    heartbeatTimeoutMs: number,
    onTimeout: (id: string) => void,
  ): boolean {
    const entry = this.entries.get(instanceId);
    if (!entry) {
      return false; // unknown instance — caller must create first
    }

    // Close old connection if exists
    if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.close(1000, 'superseded by new connection');
    }

    entry.ws = ws;
    entry.instance.status = 'online';
    entry.instance.lastSeen = Date.now();
    entry.instance.connectedAt = Date.now();

    // Reset heartbeat timer
    this.resetHeartbeat(entry, heartbeatTimeoutMs, onTimeout);

    // Handle disconnect
    ws.on('close', () => {
      if (entry.ws === ws) {
        entry.ws = null;
        entry.instance.status = 'offline';
        entry.instance.connectedAt = 0;
        entry.instance.sessionCount = 0;
        if (entry.heartbeatTimer) {
          clearTimeout(entry.heartbeatTimer);
          entry.heartbeatTimer = null;
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
    onTimeout: (id: string) => void,
    opencodeVersion?: string,
  ): boolean {
    const entry = this.entries.get(instanceId);
    if (!entry) return false;

    let changed = entry.instance.sessionCount !== sessionCount;
    entry.instance.sessionCount = sessionCount;
    entry.instance.lastSeen = Date.now();
    entry.instance.status = 'online';
    this.resetHeartbeat(entry, timeoutMs, onTimeout);

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
    return this.entries.get(instanceId)?.ws ?? null;
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

  private resetHeartbeat(
    entry: RegistryEntry,
    timeoutMs: number,
    onTimeout: (id: string) => void,
  ): void {
    if (entry.heartbeatTimer) {
      clearTimeout(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }
    entry.heartbeatTimer = setTimeout(() => {
      entry.instance.status = 'offline';
      entry.instance.connectedAt = 0;
      log.warn('instance_timeout', 'instance heartbeat timeout', { instanceId: entry.instance.id });
      onTimeout(entry.instance.id);
    }, timeoutMs);
  }
}
