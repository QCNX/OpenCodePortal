# ADR 0006: OIDC SSO Integration (Authentik)

**Date:** 2026-06-14
**Status:** Accepted

> Gateway supports Authentik SSO via OIDC (OpenID Connect) as a second browser authentication method alongside `sharedSecret`.

---

## Context

Portal originally only supported `sharedSecret` authentication (Bearer token / cookie / Basic). To support identity-provider-managed user access, OIDC SSO support is needed.

Constraints:

1. **Single-user** — Gateway does not maintain user management itself; authentication is delegated to Authentik. Authentik's application policy controls who can log in.
2. **SSO across subdomains** — after logging in on the apex Dashboard, the user must automatically be authenticated on all instance subdomains (`<id>.<baseDomain>`).
3. **Break-glass retained** — even with OIDC enabled, `sharedSecret` remains as an API access and emergency takeover path (Bearer / `?token=` / Basic).
4. **Non-fatal initialization failure** — OIDC issuer unreachable (e.g. network down) must not prevent Gateway from starting. Gateway should continue running and auto-retry discovery.
5. **OIDC priority** — When OIDC is enabled, unauthenticated browser requests get 302 → `/login` (unified page showing OIDC button and sharedSecret input). `/auth/*` routes are only valid when OIDC is configured.

### Rejected designs

- **User allowlist** — Authentik already manages who can log in. Portal shouldn't maintain a second list, reducing coupling.
- **Scheduled automatic token refresh** — currently only `access_token` is used; no refresh is done (session TTL is 24h). Users must re-login.
- **RP-initiated logout (end_session_endpoint)** — Authentik supports it, but currently logout only destroys the local session. The `postLogoutRedirectUri` config field is reserved for future extension.

---

## Decision

### 1. Authentication mode

`AuthMode` is derived from config, fixed at three values:

| Mode | Condition | Behavior |
|------|-----------|----------|
| `oidc` | `gateway.oidc` config is valid | OIDC as primary browser login; `sharedSecret` only as break-glass (API/Bearer/Basic) |
| `secret` | Only `gateway.sharedSecret` present | Traditional sharedSecret form + Bearer |
| `open` | Neither configured | No auth, all passthrough |

OIDC config is only enabled when `config.ts:parseOidc()` returns a valid `OidcConfig`. Partially filled or `${ENV}`-unresolved configs are treated as unconfigured (warn log, non-fatal — does not exit).

### 2. Authorization Code flow (PKCE)

```
Browser                    Gateway                    Authentik
  │                          │                          │
  │  GET /auth/login         │                          │
  │ ──────────────────────→  │                          │
  │                          │  PKCE code_verifier      │
  │                          │  state (CSRF)            │
  │                          │  nonce (replay)          │
  │                          │  set ocp_oidc_tx cookie  │
  │                          │  (HMAC-signed + 5min TTL)│
  │                          │                          │
  │  302 → IdP authorize     │                          │
  │ ←──────────────────────  │                          │
  │                          │                          │
  │ ──────────────────────────────────────────────────→ │
  │                          │                          │
  │ ←── auth code + state ───────────────────────────── │
  │                          │                          │
  │  GET /auth/callback      │                          │
  │ ──────────────────────→  │                          │
  │                          │  verify state + nonce    │
  │                          │  verify PKCE code        │
  │                          │  token exchange           │
  │                          │  create session          │
  │                          │  clear ocp_oidc_tx        │
  │                          │  set ocp_session cookie   │
  │  302 → / (returnTo)      │                          │
  │ ←──────────────────────  │                          │
```

**Why PKCE?** Even if the user is on the Authentik login page (cross-domain), PKCE ensures that even if the auth code is intercepted, it cannot be exchanged for a token without the code_verifier known only to Gateway.

### 3. Cookie architecture

| Cookie | Purpose | Attributes |
|--------|---------|------------|
| `ocp_session` | Long-lived (24h) login session | `HttpOnly; SameSite=Lax; Path=/; Domain=.<baseDomain>; Max-Age=86400; Secure?` |
| `ocp_oidc_tx` | Login transaction (PKCE/state/nonce) | `HttpOnly; SameSite=Lax; Path=/; Domain=.<baseDomain>; Secure?; Max-Age=300` |

**Domain strategy:**

- Production Host (matches `baseDomain`) → `Domain=.<baseDomain>` (SSO across all subdomains)
- Development Host (localhost/loopback/private IP) → no Domain (host-only cookie)

**Secure flag:**
- Appended `; Secure` when `X-Forwarded-Proto: https`
- This header is set by the front NPM; Gateway does not independently determine TLS status

`ocp_session` value = server-side randomly generated 32-byte hex, corresponding to a session record in `SessionStore`.

`ocp_oidc_tx` value = `base64url(JSON.stringify(tx)) + "." + HMAC-SHA256(payload, txSecret)`, where `txSecret` is randomly generated at process start. This ensures the transaction cookie cannot be forged and expires on process restart.

### 4. Session storage

`SessionStore` is an in-memory Map:

- `create(user, accessToken, refreshToken?)` → returns sessionId (random 32-byte hex)
- `get(id)` → checks TTL (24h), auto-deletes if expired
- `delete(id)` → logout
- Periodic cleanup (5-minute interval) removes expired sessions, uses `timer.unref()` to avoid blocking process exit

**Why in-memory instead of persisted?** On Gateway restart, all sessions become invalid and users must re-login. Acceptable for single-user self-hosted, and avoids the security risk of storing sessions (including access_tokens) in `state.jsonc`.

### 5. Non-fatal initialization (discovery retry)

`config.ts:parseOidc()` is called at Gateway startup:

```
loadConfig()
  → parseOidc(cfg.gateway.oidc)
  → validate issuer/clientId/clientSecret/redirectUri are required
  → validate redirectUri uses https (unless allowInsecureIssuer)
  → return OidcConfig | undefined
  → if failed (missing fields / env unresolved) → warn log + return undefined
```

OIDC client initialization happens in `OidcClient.init()`, which calls `oidc.discovery()` to fetch IdP metadata. If discovery fails (network unavailable/404):

```
init() fail → Gateway remains authentication-enabled and fail-closed
            → auto-retries discovery with exponential backoff (2s to 60s)
            → sharedSecret, when configured, remains the break-glass path
```

**Why not prevent Gateway startup?** A network-unreachable IdP must not take down health checks or break-glass access. However, an OIDC-only Gateway must never become open while discovery is pending or has failed, so the AuthGate is enabled before discovery begins.

### 6. Login page `/login`

Unified `/login` page (`renderLoginPage()`):

```
┌──────────────────────────────┐
│                              │
│   [OIDC SSO button]         │  ← only when oidcMode && oidcClient.isConfigured()
│                              │
│   ──── or ────               │  ← only when secretEnabled
│                              │
│   Password: [____________]  │
│                              │
│   [Login]                    │
│                              │
│   Error message (if any)     │
└──────────────────────────────┘
```

- In OIDC mode, sharedSecret input is `disabled` when `secretEnabled = false`
- Pure OIDC mode (no sharedSecret) only shows the OIDC button
- POST `/login` shares the sharedSecret validation logic (rate-limited, see ADR 0002)
- GET `/login` always returns 200 HTML, never redirects

### 7. Logout `/auth/logout`

All logout goes through `/auth/logout`:

```
1. clearCookies(res, host, secure)
   → clear ocp_auth (sharedSecret mode) and ocp_session (OIDC mode)
2. OIDC mode: OidcClient.logout()
   → delete session from SessionStore
   → clear ocp_session cookie
3. 302 → /login
```

Currently does not call Authentik's `end_session_endpoint` (no IdP-side logout). User clicking logout only destroys the local session; next visit requires re-authentication at the IdP. The `postLogoutRedirectUri` field is reserved for future RP-initiated logout.

### 8. Configuration

```yaml
gateway:
  oidc:
    issuer: "https://auth.example.com/application/o/opencode/"
    clientId: "${OIDC_CLIENT_ID}"
    clientSecret: "${OIDC_CLIENT_SECRET}"
    redirectUri: "https://portal.example.com/auth/callback"
    scopes: ["openid", "profile", "email"]      # optional, default as shown
    allowInsecureIssuer: false                   # dev-only
    # postLogoutRedirectUri: "/login"            # reserved field
```

**redirectUri must be apex**: `https://<baseDomain>/auth/callback`, cannot be a subdomain. Authentik's configured redirect URI must match.

**allowInsecureIssuer**: set to `true` only when the OIDC issuer uses `http://` (dev/test). Production must use `https://`. This flag calls `oidc.allowInsecureRequests()`.

### 9. AuthGate integration

```typescript
isAuthenticated(req): boolean {
  if (oidcMode) {
    if (oidcClient.getSession(req)) return true;     // OIDC session cookie
    if (sharedSecret && checkBearerOrToken(req)) ...  // break-glass
    if (sharedSecret && checkAuthCookie(req)) ...
    if (sharedSecret && checkBasicAuth(req)) ...      // App break-glass
    return false;
  }
  if (sharedSecret) {
    if (checkBearerOrToken(req)) return true;
    if (checkAuthCookie(req)) return true;
    if (checkBasicAuth(req)) return true;
    return false;
  }
  return true;  // open mode
}
```

OIDC session has the highest priority (checked first). Break-glass paths are only available when `sharedSecret` is configured.

---

## Consequences

### Positive

1. **Enterprise SSO** — users managed through Authentik, no passwords in Portal.
2. **Cross-subdomain SSO** — `Domain=.<baseDomain>` cookie ensures apex login authenticates all instances automatically.
3. **Secure flow** — PKCE + state + nonce full coverage, CSRF/replay protection.
4. **Break-glass retained** — sharedSecret still available as emergency entry when OIDC is unavailable.
5. **Non-fatal startup** — IdP unreachable doesn't break other Gateway functionality.

### Negative

1. **Single-user design** — SessionStore does not distinguish users, no multi-user Dashboard. Authentik controls who can log in, but Portal internally has no user-specific isolation.
2. **Local-only logout** — does not call Authentik end_session; user's IdP session remains valid. User must actively logout from the IdP. RP-initiated logout can be extended in the future.
3. **In-memory sessions** — after Gateway restart, all users must re-authenticate. Unfriendly for high-frequency restart scenarios (development iteration).
4. **OIDC-only mode requires sharedSecret for App access** — pure OIDC mode (no sharedSecret) does not support App access. Must additionally configure sharedSecret as break-glass.

### Implementation files

- `src/server/auth/oidc-client.ts` — `OidcClient`, `SessionStore`, PKCE flow
- `src/server/auth/browser-routes.ts` — `/login`, `/auth/*` routes
- `src/server/auth/gate.ts` — `AuthGate.isAuthenticated()` OIDC branch
- `src/server/config.ts` — `parseOidc()`, authMode derivation
- `src/server/webui/login-page.ts` — unified login page render
- `src/server/http/host-routing.ts` — `authCookieDomain()`
- `docs/authentik-sso.md` — setup guide

---

## References

- `src/server/auth/oidc-client.ts`
- `src/server/auth/browser-routes.ts`
- `src/server/auth/gate.ts`
- `src/server/config.ts` — `parseOidc()`
- `src/shared/types.ts` — `OidcConfig`, `AuthMode`
- `docs/authentik-sso.md` — Authentik configuration guide
- `openid-client` npm package — OIDC client library
