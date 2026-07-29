# ADR 0002: App Basic Auth Compatibility

**Date:** 2026-06-13
**Updated:** 2026-06-14
**Status:** Accepted (Revised v4 — empirically verified)
**Supersedes:** —
**Superseded by:** —

> v2 revision: Replaced "validate App credentials against `opencodePassword` + per-instance bypass switch" with
> **"Basic password as another carrier of `sharedSecret`"** — isomorphic with `Bearer`/`?token=`, no
> `AuthGate ↔ registry` coupling, naturally covers instances without `opencodePassword`, upstream password never leaked.
> Also fixes the pre-existing gap where PTY WS never injected upstream credentials.
>
> v3 revision (based on real device packet capture + OpenCode source audit): Confirmed WhisperCode's **WS credentials use `?auth_token=` query** (not `Authorization` header, not URL userinfo), worst-case ruled out.
> Two mandatory additions: **inbound `auth_token` query recognition** and **CORS preflight OPTIONS passthrough**.
> WS upstream injection must **strip inbound `auth_token` before injecting** (OpenCode's `auth_token` overrides `Authorization`).
>
> v4 revision: HTTP and WS uniformly strip `auth_token` at the outbound boundary. While empirically WhisperCode HTTP uses `Authorization` header,
> other clients or scripts may place `auth_token` in HTTP query; OpenCode lets query override Portal-injected upstream Authorization, so it must not be passed through.

---

## Context

OpenCode Portal places a Portal-level authentication layer (sharedSecret Bearer/cookie or OIDC SSO) on instance subdomains. All subdomain traffic must pass `AuthGate.isAuthenticated()` before reaching the OpenCode Server.

Third-party apps (WhisperCode, OpenCode Desktop, VS Code extension, etc.) connect to OpenCode Server using **HTTP Basic Auth**:

```
Authorization: Basic base64(username:password)
```

The default username is `"opencode"` (can be overridden by `OPENCODE_SERVER_USERNAME`), and the password corresponds to `OPENCODE_SERVER_PASSWORD`. WhisperCode is an OpenCode fork that reuses the OpenCode SDK and **only supports Basic Auth** ([whispercode#8](https://github.com/DNGriffin/whispercode/issues/8)).

Conflict points:

1. **AuthGate does not recognize Basic Auth** → App traffic gets 302 redirected to `/login`, receives HTML instead of API responses, connection fails.
2. **`proxyToAgent()` unconditionally overwrites `Authorization` header** (`src/server/proxy/request-forwarder.ts`), and hardcodes username `"opencode"`, ignoring registry `opencodeUser`.

### Additional constraints / pre-existing gaps

- **WebSocket upgrades** also go through `AuthGate.isAuthenticated()` (`browser-ws-channels.ts:33`). The App's PTY terminal depends on WS.
- **PTY WebSocket previously never injected upstream credentials.** This gap is fixed by this ADR's `channel_open.headers` approach: Gateway injects registry upstream Basic header; Agent's `openChannel()` only needs to pass through. Agent deployment config must not and does not carry `OPENCODE_*` credentials.
- **Instances without `opencodePassword`**: When OpenCode Server requires no auth, no upstream credentials are needed; but Portal must still recognize the App's authentication intent.
- Portal **must not require App modifications** — compatibility must be transparent.

### WhisperCode credential transport: empirical evidence (verified ✔)

On 2026-06-13, using a real device (WhisperCode iOS) with logging tap packet capture, cross-referenced against OpenCode server-side `AuthMiddleware` source code, the conclusions are definitive:

| Channel | Credential carrier | Example | Visible to Portal |
|---------|-------------------|---------|-------------------|
| **HTTP / REST / SSE** | `Authorization: Basic` header | `Authorization: Basic base64(opencode:pass)` | ✔ Yes |
| **PTY WebSocket** | **`?auth_token=` query parameter** | `GET /pty/<id>/connect?...&auth_token=base64(opencode:pass)`, **no** `Authorization` header | ✔ Yes (in `req.url`) |
| **CORS preflight** | No credentials | `OPTIONS /...` (`origin: tauri://localhost`) | — |

Key findings:

- WS credentials are **neither** the `Authorization` header **nor** URL userinfo, but the **`auth_token` query parameter** (value = `base64(username:password)`). The previously feared worst-case ("userinfo stripped, Portal cannot see") **does not apply** — query parameters are fully visible to Gateway, and the AGENTS.md redline already requires subdomain proxy to pass through the full `?query`.
- This is **OpenCode Server's native convention**, not a client hack. The server-side `AuthMiddleware` ([middleware.ts](https://github.com/sst/opencode/blob/b2baddcd/packages/opencode/src/server/middleware.ts)) logic:
  ```ts
  if (c.req.method === "OPTIONS") return next()                 // ① preflight passthrough
  if (!password) return next()                                  // ② passthrough when no password
  if (isPtyConnectPath(path) && c.req.query("ticket")) next()   // ③ new PTY ticket bypass
  if (c.req.query("auth_token"))                                // ④ auth_token → Authorization
    c.req.raw.headers.set("authorization", `Basic ${auth_token}`)
  return basicAuth({ username, password })(c, next)
  ```
- WhisperCode is a **Tauri WebView app** (`origin: tauri://localhost`), therefore requests with `Authorization` header first trigger **CORS preflight OPTIONS** (no credentials). 56 OPTIONS were captured in this session, all `authorization=<NONE>`.
- Forward compatibility: newer OpenCode also supports **PTY ticket** (`POST /pty/:id/connect-token` to obtain a one-time `ticket`, then connect WS with `?ticket=`). Under this path the WS URL carries no long-term key; but the POST to obtain the ticket still uses Basic, so Portal auth still gates it. The WhisperCode version tested uses the `auth_token` scheme.

> Conclusion: WS auth is **simpler than expected** (visible query parameter). But two new mandatory handling points emerged: **(a) Portal must recognize `?auth_token=` query; (b) Portal must passthrough CORS preflight OPTIONS** (otherwise all Tauri WebView requests fail at the preflight stage).

---

## Decision

**When the App's Basic credential (`Authorization: Basic` header or `?auth_token=` query) has its `password` field == Portal `sharedSecret`, treat it as authenticated (username ignored), isomorphic with existing `Bearer` / `?token=`.**

The App side only needs to put Portal's `sharedSecret` in the "server password" field (username arbitrary). After Portal validates, **rewrite/strip** upstream credentials: HTTP strips the App's `auth_token` query and overwrites `Authorization` header with `opencodeUser:opencodePassword`; WS similarly strips `auth_token`, then injects upstream Basic header via `channel_open`.

```
App fills in:  username = arbitrary      password = <Portal sharedSecret>
   │
   ├─ HTTP: Authorization: Basic base64(arbitrary:sharedSecret)
   │         or ?auth_token=base64(arbitrary:sharedSecret)
   │   └─ Gateway checkBasicAuth() → password==sharedSecret → pass
   │       └─ proxyToAgent(): strip auth_token query + overwrite Authorization with opencodeUser:opencodePassword
   │                          (no opencodePassword → delete Authorization)
   │
   ├─ WS:   /pty/<id>/connect?...&auth_token=base64(arbitrary:sharedSecret)
   │   └─ Gateway checkBasicAuth() (same function, fallback read auth_token query) → pass
   │       └─ channel_open: strip auth_token query + inject upstream Authorization: Basic opencode...
   │                        (OpenCode server: auth_token when present overrides Authorization, so must strip)
   │
   └─ OPTIONS preflight (no credentials) → passthrough to upstream (answered by OpenCode CORS middleware)
```

### Why this approach

| Dimension | Chosen approach (Basic = sharedSecret) | Rejected Plan A (Basic = opencodePassword) |
|-----------|------|------|
| `AuthGate ↔ registry` coupling | **Not needed** (sharedSecret already in AuthGate) | Needed (breaks clean auth abstraction) |
| instance lookup moved before auth | **Not needed** | Needed |
| Instance without `opencodePassword` | **Works as-is** (just don't inject upstream) | Broken, fallback to bypass naked |
| Credentials exposed to App | **Only sharedSecret**, upstream password stays server-side | Real upstream password sent to mobile device |
| Multi-instance App config | **All use same sharedSecret**, minimal mobile config | One password per instance |
| Credential rotation | sharedSecret and upstream password rotatable independently | Client credential coupled with upstream |
| Consistency with existing model | Isomorphic with `Bearer`/`?token=` | Adds third independent validation path |
| Credential injection logic | **Unconditional** injection (simpler) | Conditional injection + `skipCredentialInjection` parameter |

Trade-off: all instances share one App credential (no per-instance App granularity). For single-user self-hosted scenarios this is not a requirement; and it conveniently lets "no password" instances be accessed by App, making the original Plan B per-instance bypass switch **redundant and removed**.

### OIDC-only mode

Pure OIDC (no `sharedSecret` configured) has no Basic carrier. Per AGENTS.md, OIDC and `sharedSecret` can coexist (`sharedSecret` as break-glass). Therefore the conclusion is: **to enable App access, configure a `sharedSecret`**, and the App uses it as its password — this is naturally consistent with existing break-glass semantics. Basic validation is only enabled when `sharedSecret` is set.

---

## Detailed Design

### 1. `AuthGate.checkBasicAuth()` (no registry dependency)

```typescript
// src/server/auth/gate.ts
import * as crypto from 'crypto';

private timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;       // length mismatch → early false (length is non-secret)
  return crypto.timingSafeEqual(ab, bb);
}

checkBasicAuth(req: http.IncomingMessage): boolean {
  if (!this.sharedSecret) return false;            // only enabled when sharedSecret is configured

  // Credential sources: ① Authorization: Basic header (HTTP/REST/SSE)
  //                     ② ?auth_token= query (WhisperCode PTY WebSocket)
  const b64 = this.extractBasicCredential(req);
  if (!b64) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const password = decoded.slice(i + 1);           // username ignored
  return this.timingSafeEqualStr(password, this.sharedSecret);
}

/** Return base64(user:pass) from Authorization header or auth_token query; null if absent. */
private extractBasicCredential(req: http.IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (h && h.startsWith('Basic ')) return h.slice('Basic '.length);

  if (req.url) {
    const q = req.url.indexOf('?');
    if (q >= 0) {
      const t = new URLSearchParams(req.url.slice(q)).get('auth_token');
      if (t) return t;                             // mirrors OpenCode AuthMiddleware behavior
    }
  }
  return null;
}
```

### 2. `isAuthenticated()` integration (no new parameters, no registry)

```typescript
isAuthenticated(req: http.IncomingMessage): boolean {
  if (this.oidcMode) {
    if (this.oidcClient!.getSession(req)) return true;
    if (this.sharedSecret && this.checkBearerOrToken(req)) return true;
    if (this.sharedSecret && this.checkAuthCookie(req)) return true;
    if (this.sharedSecret && this.checkBasicAuth(req)) return true;   // 🆕 break-glass
    return false;
  }
  if (this.sharedSecret) {
    if (this.checkBearerOrToken(req)) return true;
    if (this.checkAuthCookie(req)) return true;
    if (this.checkBasicAuth(req)) return true;                        // 🆕
    return false;
  }
  return true;  // no auth configured → pass all
}
```

> Because WS upgrade also goes through `isAuthenticated(req)` (`browser-ws-channels.ts:33`), and `checkBasicAuth` already fallback-reads `?auth_token=` query, **inbound WS auth is automatically supported with no WS-specific inbound code changes**. Empirically confirmed WhisperCode WS credentials are exactly `auth_token` query (see evidence above).

### 3. `respondIfUnauthenticated()` distinguishes 401 vs 302

```typescript
respondIfUnauthenticated(req, res, options): boolean {
  if (this.isAuthenticated(req)) return false;

  // 🆕 Presented Basic credential (header or auth_token query) but failed → 401 (App is not a browser, 302 is meaningless)
  if (this.extractBasicCredential(req)) {
    res.writeHead(401, {
      'Content-Type': 'text/plain',
      'WWW-Authenticate': 'Basic realm="OpenCode Portal"',
    });
    res.end('Invalid credentials');
    return true;
  }

  // Existing 302 → /login logic (unchanged)
  // ...
}
```

### 4. `proxyToAgent()` strips `auth_token` + unconditional upstream credential rewrite

```typescript
// src/server/proxy/request-forwarder.ts
const upstreamPath = stripQueryParam(path, 'auth_token');

const password = this.options.registry.getOpencodePassword(instanceId);
if (password) {
  const user = this.options.registry.getOpencodeUser(instanceId) || 'opencode';
  req.headers['authorization'] =
    'Basic ' + Buffer.from(user + ':' + password).toString('base64');
} else {
  delete req.headers['authorization'];   // 🆕 no upstream password → delete, avoid leaking sharedSecret upstream
}

const rawRequest = serializeHttpRequest(req, body, upstreamPath);
```

No `skipCredentialInjection` parameter, no conditional branches: App's `Basic <sharedSecret>` is uniformly replaced by Portal with real upstream credentials (or deleted). `auth_token`, regardless of which HTTP client placed it, never reaches OpenCode, preventing OpenCode from using query to overwrite just-injected Authorization; other query parameters are preserved. Browser requests inherently have no `Authorization`, behavior unchanged.

### 5. PTY WebSocket: strip inbound `auth_token` + inject upstream credentials (fix pre-existing gap)

Two things must be done together:

1. **Strip App's `auth_token` query.** App's `auth_token` carries `sharedSecret`, not the upstream password. OpenCode Server `AuthMiddleware` upon seeing `auth_token` will **use it to override the Authorization header** (see Context source ④). If not stripped, our injected upstream Basic header gets overwritten by App's sharedSecret → upstream 401.
2. **Inject upstream Basic header** (fix pre-existing gap: `openChannel()` never injected upstream credentials, even browser PTY couldn't connect when upstream had a password set).

Gateway uses `channel_open` with **stripped path** + `passthroughHeaders` to inject upstream headers; Agent just passes through (`openChannel()` already forwards `headers` to upstream WS, no Agent changes needed).

```typescript
// src/server/proxy/browser-ws-channels.ts — inside handleUpgrade callback
const cleanPath = stripQueryParam(subPath, 'auth_token');   // 🆕 strip App's sharedSecret

const passthroughHeaders: Record<string, string> = {};
passthroughHeaders[TRACE_HEADER] = traceId;

const pwd = this.options.registry.getOpencodePassword(instanceId);   // 🆕
if (pwd) {
  const user = this.options.registry.getOpencodeUser(instanceId) || 'opencode';
  passthroughHeaders['authorization'] =
    'Basic ' + Buffer.from(user + ':' + pwd).toString('base64');
}

tunnel.sendControlToAgent(instanceId, {
  type: 'channel_open', channelId, path: cleanPath, headers: passthroughHeaders,
});
```

> HTTP and WS use the same outbound invariant: Portal may read `auth_token` during inbound auth, but must delete it before forwarding to OpenCode; otherwise OpenCode lets query overwrite Portal-injected Authorization.

> Note: `channel_open` still **must not** forward browser `Origin`/`Host` (AGENTS.md redline: OpenCode PTY CSRF validation requires `Host == Origin`, forwarding would 403). Only `Authorization` is added here, Origin/Host untouched.

### 6. Subdomain / WS route integration

- `handleSubdomainProxyRoute()`: **no sequence changes needed**. Still `respondIfUnauthenticated()` first, then lookup instance; Basic validation does not depend on instance, so no need to move instance lookup before auth.
- `handleWsUpgrade()`: inbound auth already automatically supports Basic (see §2); add §5 stripping + upstream header injection.

### 7. CORS preflight (OPTIONS) passthrough 🆕 (WhisperCode is Tauri WebView, mandatory)

WhisperCode's origin is `tauri://localhost`, cross-origin with the server; requests with `Authorization` header first trigger **CORS preflight `OPTIONS` (no credentials)**. If Portal AuthGate also 302/401 on OPTIONS, **all App requests fail at the preflight stage**.

`respondIfUnauthenticated()` (WS not involved with OPTIONS) passthroughs OPTIONS before auth check:

```typescript
// src/server/auth/gate.ts — at the top of respondIfUnauthenticated()
if (req.method === 'OPTIONS') return false;   // 🆕 CORS preflight passthrough, handed to upstream OpenCode
```

After passthrough, OPTIONS is proxied to upstream OpenCode, answered by its CORS middleware (`Access-Control-Allow-Origin`, etc.). **Prerequisite:** upstream OpenCode must be started with CORS allowing `tauri://localhost` (or `*`), e.g. `opencode serve --cors "tauri://localhost"` (or `--cors "*"`). This must be documented in deployment/Deploy instructions.

> Alternative: If upstream CORS config dependency is undesirable, Portal could answer preflight itself (reply `Access-Control-Allow-Origin: <origin>` / `-Headers: authorization` / `-Methods: *`). But passthrough to upstream is simpler and consistent with Portal's existing "don't rewrite business semantics" proxy style. Must confirm `overrideCacheHeaders()` / response transform does not break CORS headers on OPTIONS (no body).

---

## Authentication Decision Matrix

Priority from high to low:

| Condition | Decision | HTTP status |
|-----------|----------|-------------|
| No auth configured (no OIDC, no sharedSecret) | Pass all | Proxy |
| **`OPTIONS` preflight** 🆕 (any Host) | Passthrough (no validation) | Upstream CORS response |
| OIDC session valid | ✔ Pass | Proxy |
| Bearer token == `sharedSecret` | ✔ Pass | Proxy |
| Cookie `ocp_auth` == HMAC(`sharedSecret`) | ✔ Pass | Proxy |
| Cookie `ocp_session` valid (OIDC) | ✔ Pass | Proxy |
| `?token=` == `sharedSecret` | ✔ Pass | Proxy |
| **`Authorization: Basic` password == `sharedSecret`** 🆕 (App HTTP) | ✔ Pass | Proxy (upstream credentials rewritten) |
| **`?auth_token=` decodes to password == `sharedSecret`** (App HTTP/WS) | ✔ Pass | Proxy (strip auth_token + rewrite/inject upstream credentials) |
| Basic credential present but password ≠ `sharedSecret` | ❌ Reject | 401 + `WWW-Authenticate: Basic` |
| No credentials of any kind | ❌ Reject | 302 → `/login` |

---

## Security Considerations

### Must validate Basic contents

Do not pass any arbitrary Basic header: only when password timing-safe equals `sharedSecret` is it allowed through. Otherwise anyone knowing the subdomain could send arbitrary Basic headers to bypass Portal.

### Upstream real password never leaked

App holds `sharedSecret`, **not** `opencodePassword`. Portal rewrites/deletes `Authorization` at the outbound direction, so upstream password always stays server-side; the two can rotate independently.

### Basic path bypasses OIDC application policy (intentional trust boundary expansion)

AGENTS.md states "who may log in is enforced by the Authentik application policy". The Basic (`=sharedSecret`) path is **not constrained by that policy**, equivalent to the existing `sharedSecret` break-glass channel extension. Acceptable for single-user self-hosted; if multi-user is introduced in the future, the Basic path may need to be restricted to specific instances/tags.

### Timing-safe comparison

New `checkBasicAuth` uses `crypto.timingSafeEqual`. Existing `checkBearerOrToken`/`checkAuthCookie` still use `===` (pre-existing issue, can be unified later, out of scope for this ADR).

### Transport security

Basic credentials are carried in plaintext, dependent on TLS. Portal's front NPM terminates TLS; Gateway↔Agent is encrypted WSS tunnel; Gateway internal hop has no TLS (same as existing architecture).

### CORS / OPTIONS preflight (empirically mandatory)

Empirically, WhisperCode (Tauri WebView, `origin: tauri://localhost`) **sends CORS preflight OPTIONS** (56 captured in this session, all no credentials). Portal must passthrough OPTIONS (see Detailed Design §7), otherwise all App requests fail. After passthrough, upstream OpenCode CORS middleware answers, so upstream must start with `--cors` allowing that origin. Passthroughing OPTIONS itself does not lower security — real data requests still go through Basic/`auth_token` validation.

---

## Alternatives Considered

### Plan A: Basic = `opencodePassword` (original v1 mainline, rejected)

Validate App using the instance's `opencodeUser:opencodePassword`. **Rejected because:** introduces `AuthGate↔registry` coupling, requires moving instance lookup before auth, breaks for instances without password, sends real upstream password to client, not isomorphic with existing token model. This approach avoids all of these at equivalent security level, see Decision comparison table.

### Plan B: Per-instance `portalAuthBypass` switch (original v1 supplement, rejected)

Provide a "skip all Portal auth" switch for instances without password. **Rejected because:** this approach's Basic=`sharedSecret` already covers instances without password (just don't inject upstream), making bypass redundant; and bypass pushes the entire security responsibility to the network layer — one misconfiguration and unauthorized access occurs, the additional Dashboard switch and persistence field are not worth it. If "complete naked relying on Tailscale/VPN/NPM whitelist" is truly needed, it should be done at the network layer, not as a Portal config item.

### Plan C: App Token (independent `ocp-ap-*` Bearer)

Generate independent tokens per instance, App configured with `Bearer`. **Rejected because:** WhisperCode only supports Basic, not Bearer, requiring App modification; and introduces a third token system, increasing user cognitive load and system complexity.

### User-Agent detection

Distinguish browser/app by UA to automatically decide whether to require Portal auth. **Rejected because:** UA is spoofable, not a security mechanism; desktop App and browser UAs are hard to distinguish. Credential validation is a stronger guarantee.

---

## Consequences

### Positive

- App **zero modification** to connect: just fill Portal `sharedSecret` in "server password" field.
- One `sharedSecret` serves App access for all instances, minimal mobile config.
- Browser experience completely unchanged; auth model stays isomorphic (Basic is just another carrier of `sharedSecret`).
- **Incidentally fixes** the pre-existing gap where PTY WebSocket never injected upstream credentials (benefits both browser and App).
- No `AuthGate↔registry` coupling, no new config items or Dashboard complexity.

### Negative / Limitations

- App access granularity is global (all instances share `sharedSecret`), no per-instance App credentials.
- Pure OIDC mode must additionally configure `sharedSecret` to enable App access.
- Depends on upstream OpenCode started with `--cors` allowing `tauri://localhost` (must be in deployment instructions).

### Risks

| Risk | Mitigation |
|------|-----------|
| ~~WS upgrade credentials invisible (userinfo stripped)~~ | **Empirically ruled out**: WhisperCode WS uses `?auth_token=` query, fully visible to Gateway |
| Inbound `auth_token` not stripped causes upstream 401 (OpenCode prioritizes query) | HTTP strips before serialization, WS strips before `channel_open`, using `stripQueryParam(path,'auth_token')`, and injects upstream Basic header |
| CORS preflight intercepted by AuthGate → all App requests fail | §7 passthrough OPTIONS; upstream `--cors` allow `tauri://localhost` |
| Basic plaintext transport | Relies on NPM TLS termination; same as existing architecture |
| Basic bypasses OIDC policy | Documented explicitly as break-glass extension; re-evaluate for multi-user |
| Upstream OpenCode username not default `opencode` | Injection uses registry `opencodeUser`, hardcoding already fixed |
| Newer OpenCode switches to PTY `ticket` instead of `auth_token` | ticket obtained via authenticated POST, WS URL carries no long-term key; Portal auth still gates the POST. Must regression-test on upgrade |

---

## Implementation Plan

> Phase 0 (pre-validation) complete: WhisperCode WS credentials = `?auth_token=` query (dual confirmed by empirical test + OpenCode source audit), worst-case ruled out.

### Phase 1: Inbound auth (Basic header + auth_token query + OPTIONS passthrough)

| Step | Change |
|------|--------|
| 1 | `AuthGate.extractBasicCredential()` (Authorization header → fallback `auth_token` query) + `timingSafeEqualStr()` |
| 2 | `checkBasicAuth()` uses `extractBasicCredential` to get credential, password==sharedSecret timing-safe compare |
| 3 | `isAuthenticated()` both branches integrate `checkBasicAuth` (only when `sharedSecret` exists) |
| 4 | `respondIfUnauthenticated()`: **passthrough `OPTIONS` at top**; for Basic/auth_token failure return 401 + `WWW-Authenticate: Basic` |
| 5 | Unit tests: header pass / auth_token query pass / password mismatch 401 / no sharedSecret not enabled / OPTIONS passthrough / malformed base64 / username ignored / timing-safe |

### Phase 2: Upstream credential rewrite (HTTP + WS)

| Step | Change |
|------|--------|
| 6 | `proxyToAgent()` strip `auth_token` query, unconditional rewrite: has password→`opencodeUser:opencodePassword`, no password→delete `Authorization` |
| 7 | `browser-ws-channels.ts`: `stripQueryParam(path,'auth_token')` + `channel_open.headers` inject upstream Basic (fix pre-existing WS gap) |
| 8 | Integration tests: HTTP `auth_token` inbound auth→strip+upstream rewrite; WS `auth_token` inbound auth→strip+upstream inject; OPTIONS preflight passthrough; browser without Authorization still works |
| 9 | E2E: simulate WhisperCode (HTTP `Authorization` + WS `auth_token` + OPTIONS preflight, password=sharedSecret) → Portal → echo server |

### Phase 3: Deployment instructions

| Step | Change |
|------|--------|
| 10 | Deploy instructions supplement: upstream `opencode serve --cors "tauri://localhost"` (or `"*"`); App side "server password" fill Portal `sharedSecret`, username arbitrary |

---

## References

- [WhisperCode GitHub](https://github.com/DNGriffin/whispercode) · [whispercode#8 Basic Auth support](https://github.com/DNGriffin/whispercode/issues/8)
- [OpenCode Server docs](https://opencode.ai/docs/server/) — `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME`
- [OpenCode `AuthMiddleware` source](https://github.com/sst/opencode/blob/b2baddcd/packages/opencode/src/server/middleware.ts) — `OPTIONS` passthrough, `auth_token` query→Authorization, PTY `ticket` bypass (**factual basis for this ADR's design**)
- [opencode#19920](https://github.com/anomalyco/opencode/issues/19920) · [opencode#19923](https://github.com/anomalyco/opencode/pull/19923) — Web client WS credential history (userinfo), differs from native App's `auth_token`
- **Empirical packet capture:** 2026-06-13 WhisperCode iOS (Tauri, `origin: tauri://localhost`) via logging tap → HTTP `Authorization: Basic` / WS `?auth_token=base64(user:pass)` / 56× OPTIONS no credentials
- ADR 0001 — initial architecture decision
- `src/server/auth/gate.ts` · `src/server/proxy/request-forwarder.ts` · `src/server/proxy/browser-ws-channels.ts` · `src/agent/forwarder.ts`
