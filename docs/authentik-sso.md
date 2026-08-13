# Authentik OIDC SSO

OpenCode Portal supports OIDC Single Sign-On as the **primary** browser auth.
It is designed for a **single user**: who may log in is decided by the
Authentik application's authorization policy, not by a Portal-side allowlist.

When the `gateway.oidc` block is configured:

- **OIDC is the primary browser login.** Unauthenticated requests redirect to
  `/login` — a unified page with an **Authentik** button and a **sharedSecret**
  field (input disabled when `sharedSecret` is not configured). Bearer/`?token=`
  auto-cookie issuance remains masked in OIDC mode.
- **`sharedSecret` stays as a break-glass.** `Authorization: Bearer <secret>`
  and `?token=<secret>` keep working for API/scripts and for recovery when
  Authentik is unreachable. The Gateway does **not** crash if discovery fails
  at startup — it stays up (break-glass usable) and retries discovery with
  backoff until the IdP comes back.

The session cookie (`ocp_session`) is scoped to `.<baseDomain>`, so one login
covers the apex Dashboard and every instance subdomain.

## 1. Configure Authentik

Create an **OAuth2/OpenID Provider** + **Application**:

| Field | Value |
|-------|-------|
| Client type | **Confidential** |
| Redirect URI | `https://<baseDomain>/auth/callback` (exact match) |
| Scopes | `openid`, `profile`, `email` |
| Signing/flow | default authorization-code flow (PKCE is used automatically) |

Restrict access to your single user by binding an **authorization policy**
(e.g. group membership or a single-user policy) to the Application. Anyone the
policy rejects never reaches the Portal.

Note the **Issuer/OpenID Configuration URL** (e.g.
`https://auth.example.com/application/o/opencode/`), the **Client ID**, and the
**Client Secret**.

## 2. Configure the Gateway

In `config.yaml`:

```yaml
gateway:
  baseDomain: "portal.example.com"
  # sharedSecret: "ocp-sk-..."   # optional break-glass / API token
  oidc:
    issuer: "https://auth.example.com/application/o/opencode/"
    clientId: "${OIDC_CLIENT_ID}"
    clientSecret: "${OIDC_CLIENT_SECRET}"
    redirectUri: "https://portal.example.com/auth/callback"
    # scopes: ["openid", "profile", "email"]   # optional (default)
    # allowInsecureIssuer: true                 # dev/test only for http:// issuers
    # sessionTtlHours: 24                       # optional session lifetime (hours)
```

Provide secrets via a `.env` file in the Gateway working directory (auto-loaded
at startup; `${VAR}` substitution in `config.yaml` reads `process.env`):

```bash
cp .env.example .env
# edit .env:
#   OIDC_CLIENT_ID=<from Authentik>
#   OIDC_CLIENT_SECRET=<from Authentik>
```

`.env` is gitignored. For Docker, `docker-compose.gateway.yml` mounts it via
`env_file`. For Docker Compose, add them to the `.env` file.

An incomplete `oidc` block (missing a required field, or an unresolved
`${ENV}` placeholder) is **ignored with a warning** — the Gateway then falls
back to `sharedSecret` (or open) instead of failing to start on a typo.

### Session lifetime

The browser session follows the standard OIDC split between short-lived
credentials and the user session:

- **Session (cookie) lifetime is decided by the Portal** — `sessionTtlHours`
  (default 24h). It is *not* tied to the Authentik access-token lifetime:
- **The access token is silently refreshed in the background** with the
  refresh token (`expires_in` from the token endpoint), so a short access-token
  validity (Authentik's default is 5 minutes) never logs the user out.
- **IdP-side revocation propagates**: if Authentik rejects the refresh (session
  revoked, password changed, policy changed), the Portal session is dropped and
  the user is asked to log in again.

```yaml
gateway:
  oidc:
    ...
    sessionTtlHours: 48   # force a 48h session; access tokens refresh silently meanwhile
```

Keep **Access token validity** short (e.g. 5 minutes) for security — it no
longer affects how long the user stays logged in. A longer **Refresh token
validity** (Providers → your provider → Advanced protocol settings) allows
longer-lived sessions without re-login; `sessionTtlHours` caps the session
regardless.

## 3. Reverse proxy (NPM)

`/auth/login`, `/auth/callback`, and `/auth/logout` live on the **apex**
`baseDomain` and are proxied like any other apex path (see
[npm-setup.md](npm-setup.md)). No special location blocks are needed — the
Gateway routes them internally. Ensure the public scheme is HTTPS so the
`redirectUri` matches.

`http://` OIDC issuers are rejected by default. For local development only, set
`allowInsecureIssuer: true`; do not enable it for production.

## 4. Login flow

1. Browser hits any protected URL → `302 /login`.
2. User picks **Authentik login** (`/auth/login`) or **secret login** (when
   `sharedSecret` is configured).
3. OIDC path: Gateway sets a short-lived signed transaction cookie (`ocp_oidc_tx`,
   carrying PKCE verifier + `state` + `nonce`) and redirects to Authentik.
4. Authentik authenticates + authorizes the user, redirects back to
   `/auth/callback`.
5. Gateway validates `state`/`nonce`/PKCE, creates an in-memory session, sets
   `ocp_session` (`Domain=.<baseDomain>`), and redirects to `/`.

**Logout** is local: `/auth/logout` (Dashboard header, injected OC Portal
dropdown "Logout", or direct URL) destroys the Gateway session and
redirects to `/login`.
The Authentik session itself is left intact (no IdP `end_session` call).

## 5. Break-glass / API access

Even in OIDC mode, the `sharedSecret` (if configured) works for non-browser
clients and emergencies:

```bash
curl -H "Authorization: Bearer $OCP_SECRET" https://portal.example.com/
curl "https://portal.example.com/?token=$OCP_SECRET"
```

This path does **not** issue the `ocp_auth` cookie (sessions are the source of
truth in OIDC mode) and is the recommended way back in if Authentik is down.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Redirect loop to `/login` | `redirectUri` mismatch, or cookies blocked. Confirm exact Redirect URI and that the public origin is HTTPS. |
| `Login session expired or missing` on callback | `ocp_oidc_tx` cookie lost (>5 min, or `Domain`/HTTPS mismatch). Restart the login. |
| `500` on `/auth/login` | Discovery not yet successful (IdP unreachable). Check Gateway logs for `oidc init failed — will retry`; use break-glass meanwhile. |
| Logged in on apex but instance subdomain re-prompts | `baseDomain` must match the real apex so `ocp_session` is scoped correctly. |
| `authMode` in startup log | `oidc` when the block is valid; `sharedSecret`/`none` otherwise. |
