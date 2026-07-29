# OpenCode Portal — Glossary

> Terminology reference. Terms defined here carry consistent meaning across all project documentation.

---

## Core Concepts

- **Gateway**: Central gateway server. Handles user authentication, instance discovery, and request forwarding. Listens on a single ws port; TLS is terminated by front NPM.
- **Agent**: Lightweight process running on each VM/VPS. Initiates WSS connections to Gateway. Receives forwarded requests from Gateway and relays them to the local OpenCode Server.
- **OpenCode Server**: The user-facing OpenCode instance running on the VM/VPS at `localhost:4096` (default), only reachable locally by the Agent.
- **Instance**: A logical instance corresponding to one Agent. Created via Gateway Dashboard CRUD API; its id doubles as the DNS subdomain. Instance definition (id, name, tags, token, opencodeUser, opencodePassword) persisted in `data/state.jsonc`.
- **Token**: Authentication credential carried by Agent when connecting to Gateway. Each Instance is automatically assigned a per-instance token `ocp-at-*` at creation time; Agent registers and establishes the tunnel connection using this token.
- **Gateway ID**: A persistent UUID auto-generated on Gateway's first startup, stored in `data/state.jsonc`. Returned to Agent on successful registration.
- **NPM**: Nginx Proxy Manager, front reverse proxy. Handles TLS termination and forwards external traffic to Gateway's ws port.
- **Client**: OpenCode client software used directly by end users. Includes browser Web UI, WhisperCode App (iOS/Android), OpenCode Desktop (Tauri), VS Code extension, SDK integrations, etc. All clients communicate with OpenCode Server via HTTP + WebSocket.
- **baseDomain**: The apex domain in Gateway config (e.g. `portal.example.com`). Portal routes (Dashboard, `/login`, `/health`, `/portal.css`) are served on this Host. `localhost`, loopback, and RFC1918 private IPs act as dev apexes but still respect configured sharedSecret/OIDC auth. Must match the `Host` header forwarded by NPM (no port). Unmatched public Hosts get 404 with `unknown host` log.
- **subdomain**: Each Instance's id is the DNS label (e.g. `dev`), forming the instance Host `<id>.<baseDomain>` (e.g. `dev.portal.example.com`). Gateway routes by `Host` header; all paths on an instance subdomain are proxied as-is to OpenCode.
- **Subdomain Routing**: Each Instance exclusively owns one subdomain origin. OpenCode SPA's `window.location.pathname` remains the true path — no path prefix or instance-selection cookie needed. NPM must reverse-proxy both apex and `*.<baseDomain>` to Gateway while preserving the `Host` header.
- **sessionCount**: The metric shown in the Dashboard "Active proxies" column. Count of Agent-side in-flight HTTP/SSE proxy connections (**not** OpenCode sessions, **excludes** WS PTY terminals). Typically ~1–2 per browser tab (a persistent SSE). A consistently elevated count may indicate leaked connections. Runtime-only metric, not persisted in `state.jsonc`.
- **opencodeVersion**: The upstream OpenCode Server version detected by the Agent via periodic probing of `/global/health`. Reported in heartbeat messages and displayed in the Dashboard "OpenCode Version" column. Runtime-only metric, not persisted in `state.jsonc`. Agent retries hourly on probe failure.
- **SSO Auth Cookie**: On production domains, `ocp_auth` / `ocp_session` cookies are scoped to `Domain=.<baseDomain>`, so a single login on apex is shared across all instance subdomains. Dev apex hosts use host-only cookies.
- **OpenCode Server Credentials**: Optional OpenCode HTTP Basic Auth. Dashboard's `opencodeUser` / `opencodePassword` must match the host's `opencode serve` credentials (`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`). Gateway strips the client's `auth_token` query before outbound HTTP/WS and injects the registry's `Authorization: Basic` header. Agent only passes through — it does not configure or validate upstream credentials. Credentials are stored in `data/state.jsonc`. Dashboard API/SSE never exposes the password in plaintext (only `hasOpencodePassword`); the username is visible in the edit form. PATCH omitting a field means no change; `null` means clear the corresponding field.

## Connection Model (Portainer Edge Agent style)

- Agent **initiates** WSS connections to Gateway. Zero inbound ports on the Agent side.
- Works for both internal networks (PVE virtual bridge direct connection) and external VPS (NAT traversal).
- Agent registers with a token; Gateway validates and returns instance ID + per-instance token + Gateway ID.
- Agent **persists** instanceId + token to `data/agent-state.jsonc`. On restart, reconnects with self-declared identity; Gateway overwrites the old connection.
- TLS termination is handled by NPM; Gateway internally handles only ws.

## Excluded Concepts

- **Direct proxy mode (Proxy Mode)**: Removed. Only Agent mode (WSS tunnel) remains.
- **Agent ID (UUID)**: Removed. Agent does not need its own persistent identifier; instanceId + token persistence suffices.
- **Multi-channel multiplexing**: Removed. The WSS tunnel does not need channel-level multiplexing; control messages and data forwarding share the same connection.
- **Static instance config**: Removed. config.yaml no longer contains instances/tokens; instances are fully managed via the API.

## Tunnel Protocol

- A single WSS long-lived connection is maintained between Agent and Gateway.
- **text frame** → JSON control messages (register, heartbeat, error, etc.).
- **binary frame** → data forwarding (HTTP request/response, WebSocket passthrough).
- Binary frame format: `[4 bytes: requestId (uint32 big-endian)] [N bytes: payload]`
- Frame type (HTTP request/response/WS) is not tagged; both ends' forwarders infer from context.
- Direction is implicit (WSS is bidirectional); no extra direction marker in headers.
- **WebSocket frame types**: WS channel data carries a 1-byte tag inside tunnel binary frames (`0x00`=text, `0x01`=binary). Gateway/Agent preserve the original WS frame type during relay. OpenCode PTY uses **binary frames** to send cursor metadata (`0x00` + `{"cursor":N}` JSON); PTY output is text frames. All WS data must not be uniformly converted to text, or the terminal will display control JSON like `{"cursor":0}`.
- **SSE streaming**: `Content-Type: text/event-stream` responses use multi-frame transmission under the same `requestId`: (1) HTTP response headers, (2) body chunks, (3) empty payload = stream end. Non-SSE responses remain single-frame buffered. OpenCode's `/event`, `/global/event` depend on this to push real-time events like `pty.exited`.
- **Proxy body size limits**: Gateway rejects buffered proxy requests over 50 MiB (413). Agent rejects buffered non-SSE upstream responses over 50 MiB (502). SSE streaming responses are exempt.
- **Request cancellation**: When the browser disconnects or Gateway times out an in-flight HTTP/SSE proxy request, Gateway sends `request_cancel` to Agent. Agent destroys the corresponding upstream request and decrements `sessionCount`, preventing OpenCode SSE connection leaks on Dashboard/instance switching.
- **Proxy page nav injection**: Gateway's `injectNavBar()` injects an inline `<script>` before `</body>` in proxied HTML, mounting the **OC Portal** button (`#_ocp_portal`) as the **firstElementChild** of the correct titlebar mount point. The script detects V2 vs Legacy UI at runtime via `document.body.hasAttribute('data-new-layout')` and uses the matching component contract: **Legacy** mounts to `#opencode-titlebar-left` with `data-component="button"` / `data-slot="dropdown-menu-item"` / `data-component="dropdown-menu-content"`; **V2** mounts to `#opencode-titlebar-right` with `data-component="button-v2"` / `data-component="menu-v2-item"` / `data-component="menu-v2-content"`. Both modes reuse OpenCode theme CSS variables (legacy `--button-secondary-*` / `--surface-raised-*`, V2 `--v2-background-*` / `--v2-text-*` / `--v2-icon-*`). The **instance switch submenu (`#_ocp_submenu`) is directly attached to `document.body` (`position:fixed`)**, not nested inside the main menu, to avoid `overflow:hidden` clipping. Position is calculated from `#_ocp_switch getBoundingClientRect()` and opens to the **right** of the main menu. An 80ms hover-delay timer keeps it open while the mouse travels between trigger and submenu. i18n: `detectLocale()` reads `document.documentElement.lang`, `language` cookie, `navigator.language`; `zh` → Simplified Chinese, `zht` → Traditional Chinese. **OC Portal button text is always English, never translated.** Menu labels are updated in real-time by `refreshLabels()` on `lang`/`data-theme`/`data-color-scheme` changes.
- **Proxy page CSP whitelist**: OpenCode responses carry a strict CSP (HTTP header + optional `<meta http-equiv="Content-Security-Policy">`), typically containing both `script-src` and `script-src-elem`. The injected inline `<script>` must have its **exact** sha256 (base64) whitelisted in **every** script-class directive, or the browser blocks it and the nav controls never mount. `injectNavBar()` computes the hash (varies with instance list). `patchCspPolicyString()` appends `'sha256-<hash>'` to all `script-src`/`script-src-elem` (falls back to `default-src` when no script directive exists). `patchCspForScript()` patches response headers (including report-only). `patchCspInHtml()` patches meta tags. `'unsafe-inline'` has no effect when hashes/nonces are present.
- **Proxy response cache**: `overrideCacheHeaders()` sets `Cache-Control: no-cache` on all proxied responses, preserving `ETag`/`Last-Modified` for cheap 304 revalidation.
- **Subdomain proxy query strings**: The instance subdomain catch-all must pass the full request `url` (including `?query`) to `proxyToAgent`, not just the path, or APIs like `/api/file/list?path=...` will lose parameters. HTTP/WS only strip `auth_token` (Portal's inbound auth parameter) at the outbound boundary; all other query parameters are preserved.

## Heartbeat

- Agent sends heartbeat every 30s with `sessionCount` (active proxy count) and optional `opencodeVersion` (upstream OpenCode version, discovered by Agent via `/global/health`). A debounced immediate heartbeat (~1s) is also sent when `sessionCount` changes.
- Gateway replies with `heartbeat_ack`. `sessionCount` changes are pushed immediately via Dashboard SSE.
- Gateway marks instance as offline after 90s without heartbeat. `sessionCount` is zeroed on Agent disconnect.

## Storage

- **Instance registry**: Pure in-memory. Gateway restores state from `data/state.jsonc` on startup.
- **Gateway state**: Persisted to `data/state.jsonc` (JSONC format). Includes gatewayId, all instance definitions, per-instance tokens, opencodeUser, opencodePassword. Auto-persisted on every mutation.

## Instance Registration

- Phase 1: Dashboard CRUD API pre-creates instances with auto-assigned per-instance tokens. Agent registers using that token.
- After first connection, Agent persists instanceId + token to `data/agent-state.jsonc`. On reconnect, it self-declares its identity.
