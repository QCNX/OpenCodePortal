# ADR 0004: Agent Identity & Registration Model

**Date:** 2026-06-14
**Status:** Accepted (Revised — per-instance assignedToken only, no globalToken)

> Agent uses self-declared identity (instanceId + per-instance token) to register with Gateway. No independent Agent UUID or global registration token.

---

## Context

Portal must support Agent disconnect/reconnect, token rotation, and Dashboard-managed instance lifecycle. The identity model must satisfy:

1. **Zero inbound ports on Agent** — Agent must be the WSS initiator; Gateway can never connect to Agent proactively.
2. **Token rotatable** — When Dashboard resets a token, Agent should be able to re-authenticate without losing instance identity.
3. **Graceful Gateway state loss** — If `data/state.jsonc` is lost, instance mappings are gone; Agent should fail cleanly rather than silently registering to the wrong instance.
4. **No independent Agent persistent identifier** — No UUID; instanceId + token uniquely determines identity.

### Rejected approaches

- **Global registration token (`ocp-gr-*`)**: Originally a global token was used for first-time registration, after which Gateway assigned a per-instance token. In practice, configuring a per-instance token directly in the Agent deploy script is simpler; the global token was an unnecessary intermediate step (refactor #47, 2026-06-12).
- **Agent UUID**: Adds complexity with no benefit; instanceId + token is already a composite key on the Gateway side.
- **Static config.yaml instances section**: Original ADR 0001 argued in detail — instance management must be dynamic at runtime, not config-file-based.

---

## Decision

### 1. Identity = instanceId + assignedToken

Agent's persistent identity consists of two fields stored in `data/agent-state.jsonc`:

```jsonc
{
  "instanceId": "my-dev-vm",
  "token": "ocp-at-xxxx"
}
```

- **instanceId** — Gateway-assigned/user-specified human-readable identifier (also the DNS subdomain).
- **token** — Per-instance authentication credential, format `ocp-at-*` (`TOKEN_PREFIX`).

No independent Agent UUID. On the Gateway side, `instanceId` is the registration entity; a new connection with the same `instanceId` overwrites the old connection.

### 2. Registration flow

```
Agent                              Gateway
  │                                   │
  │──── WSS open ────────────────────→│
  │                                   │
  │──── {"type":"register",           │
  │      "token":"ocp-at-xxxx",       │
  │      "instanceId":"my-dev-vm",    │  ← first connection: no instanceId
  │      "agentVersion":"1.2.3"} ───→│  ← optional build version (package.json)
  │                                   │
  │                                   │── registry.verifyToken(token)
  │                                   │    → match per-instance token
  │                                   │    → return instance info
  │                                   │
  │←─── {"type":"registered",         │
  │      "status":"ok",               │
  │      "assignedId":"my-dev-vm",    │
  │      "assignedToken":"ocp-at-...",│  ← may be existing token
  │      "gatewayId":"uuid"} ────────│
  │                                   │
  │─── persist instanceId + token ───→│  ← write to agent-state.jsonc
```

**First registration**: Agent carries only token (from `config.registrationToken`), may also carry the `AGENT_INSTANCE_ID` variable. Gateway looks up the token to determine instanceId.

**Reconnect registration**: Agent carries `token` and `instanceId`. Gateway verifies token belongs to that instance, then overwrites old WSS connection (old connection is closed).

**Why self-declared instead of Gateway-assigned?** Agent needs to know its own instanceId to identify itself in logs/metrics. Gateway's role is validation, not identity discovery.

### 3. Token verification

Verification function `registry.verifyToken(token)` returns `{ valid, instanceId?, reason? }`:

- Queries all registered instances' `assignedToken` for exact match
- No match → `{ valid: false, reason: 'token not found' }`
- Match but instance does not exist → `{ valid: false, reason: 'instance not found' }` (defensive)

**Source**: Per-instance tokens only (`ocp-at-*`). `globalToken` and `seed token` are no longer supported.

### 4. Gateway connection management

| Event | Behavior |
|-------|----------|
| New connection registered | `instance.status = 'online'`, record `lastSeen`, `connectedAt`; overwrite old connection |
| Old connection overwritten | Old WS closed (code 1000), old connection's `sessionCount` zeroed |
| Heartbeat received | Update `lastSeen`; `sessionCount` change triggers SSE `/events` push |
| 90s no heartbeat | Mark `status = 'offline'`, retain state, do not delete |
| Agent disconnected | Mark offline, `sessionCount` zeroed, release registered connection |
| `request_cancel` | Only sent when corresponding Agent is online |

### 5. Close code conventions

| Close code | Meaning | Agent behavior |
|-----------|---------|----------------|
| 1000 | Normal closure | Reconnect |
| 4001 | Token rejected | Permanently stop reconnecting |
| 4002 | Instance not found | Permanently stop reconnecting |
| 4003 | Registration failed (other) | Permanently stop reconnecting |
| 1008 | Policy violation | Permanently stop reconnecting |

Any other close code → infinite retry.

### 6. Reconnection behavior

```
disconnect → [baseDelay=1s] → connect
  fail → [delay×2, max=60s] → connect
  fail → [delay×2, max=60s] → connect
  ...
  success → reset delay to baseDelay
```

Permanent reconnect stop only on close codes 4001/4002/4003/1008 (Agent terminates its own process).

### 7. agent-state.jsonc lifecycle

```
First start:
  1. Agent reads instanceId + token from env vars / config file (or token only)
  2. Connect to Gateway → register → write agent-state.jsonc
  
Restart:
  1. Read instanceId + token from agent-state.jsonc (preferred over config)
  2. Connect to Gateway → register (self-declared identity)
  
Persistence guarantee:
  - Docker Run deploy template mounts volume: ocp-agent-<id>-data:/app/data
  - Docker Compose also uses named volume agent-data
  - state.jsonc written atomically (write temp → fs.rename)
```

### 8. Gateway state.jsonc format

```jsonc
{
  "gatewayId": "uuid-v4",
  "cookieSecret": "hmac-key-for-ocp-auth",
  "instances": {
    "my-dev-vm": {
      "name": "My Dev VM",
      "tags": ["dev", "linux"],
      "assignedToken": "ocp-at-xxxx",
      "opencodeUser": "opencode",
      "opencodePassword": "xxx"     // optional, upstream password
    }
  }
}
```

- `gatewayId` — auto-generated, persisted
- `cookieSecret` — used for `ocp_auth` cookie HMAC signing, auto-generated if missing
- `instances` — keyed by instanceId, values contain name/tags/token/credentials
- Legacy `globalToken` field marked `@deprecated`, read-compatible, never written

---

## Consequences

### Positive

1. **No global shared secret** — each instance has an independent token; leaking one doesn't affect others.
2. **Identity separated from credentials** — `instanceId` is immutable across the instance lifecycle; `token` can be independently rotated.
3. **Persistent definitions are recoverable** — `state.jsonc` contains instance definitions and credentials; live WSS connections, heartbeat state, and sessions are runtime-only and reconnect after restart.
4. **Agent self-contained** — container's `/app/data` volume persists state; container recreation auto-restores connection.
5. **Overwrite-style reconnect** — port/IP changes don't affect registration; new connection auto-assumes identity.

### Negative

1. **state.jsonc is a single point of failure** — loss means all instance token mappings are gone, Agent reconnections fail. Must configure backup strategy (nightly backup of data/ directory).
2. **Token stored in plaintext on disk** — both Gateway and Agent sides store tokens in plaintext. Mitigation: file permissions 0600, data directory 0700.
3. **instanceId is immutable** — changing an instance's subdomain requires delete and recreate; Agent side must also update AGENT_INSTANCE_ID.
4. **No multi-Agent load balancing** — one instance maps to one Agent connection. Multi-replica scenarios need different instanceIds.

### Implementation files

- `src/shared/types.ts` — `PersistenceState`, `PersistenceInstance`, `RegisterMessage`, `RegisteredMessage`
- `src/shared/state.ts` — `StateStore` interface, `JsoncStateStore` file I/O
- `src/server/registry.ts` — `verifyToken()`, heartbeat timeout, state management
- `src/server/tunnel.ts` — WSS registration handling
- `src/agent/tunnel.ts` — WSS registration send, reconnection, close code handling
- `src/agent/config.ts` — load/save `agent-state.jsonc`

---

## References

- `src/shared/types.ts` — `TOKEN_PREFIX`, `AGENT_STATE_FILE`, `TokenVerifyResult`
- `src/server/registry.ts` — `verifyToken`, `registerInstance`, `disconnectInstance`
- `src/agent/tunnel.ts` — close code judgment, reconnect backoff
- `src/agent/config.ts` — `loadAgentState()`, `saveAgentState()`
- `src/shared/state.ts` — `JsoncStateStore`
