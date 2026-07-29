# OpenCode Portal

> Unified entrypoint for OpenCode Server instances across multiple VMs/VPS — instance discovery, token-based authentication, reverse proxy, and secure external access.

[中文文档](docs/zh/README.md)

## The Problem

Running OpenCode Server on multiple machines means:
- Scattered entrypoints — hard to remember IPs and ports
- Duplicated auth setup on every instance
- No unified status overview
- No secure way to expose instances to the internet without opening ports on every VM

## Architecture

Inspired by the Portainer Edge Agent model: a lightweight Agent on each VM **initiates** a WSS connection to the Gateway. Zero inbound ports on the VM side.

```
Browser ──→ Gateway ←── WSS tunnel ──→ Agent → OpenCode:4096
  App         │ (selector)  (Agent initiates)    (localhost only)
              │
              ├─ portal.example.com           → Dashboard (apex)
              ├─ <sub>.portal.example.com     → OpenCode instance (subdomain proxy)
              ├─ /login                       → Unified login (OIDC + sharedSecret)
              └─ /auth/*                      → Authentik OIDC SSO
```

TLS is terminated by front NPM (Nginx Proxy Manager); Gateway handles only raw ws internally.

**Security:**
- VMs have zero inbound ports — no attack surface
- Compromising the Gateway does not enable lateral LAN scanning
- Agent only exposes the specified service

### Proxied Page Integration

Gateway injects an **OC Portal** dropdown menu into proxied OpenCode HTML pages:

| Mechanism | Purpose |
|-----------|---------|
| `injectNavBar()` | Mounts Portal button into OpenCode's titlebar; dropdown reuses OpenCode theme |
| `patchCspForScript()` | Whitelists injected script's sha256 in CSP headers (script-src + script-src-elem) |
| `patchCspInHtml()` | Patches `<meta>` CSP tags in HTML |
| `overrideCacheHeaders()` | Sets `Cache-Control: no-cache` on proxied responses (preserves ETag for 304) |
| Subdomain routing | `<id>.<baseDomain>`; Gateway routes by `Host` header |
| Body limits | 50 MiB cap on buffered proxy requests/responses (SSE streams exempt) |

See [CONTEXT.md](./CONTEXT.md) for the full glossary and [AGENTS.md](./AGENTS.md) for architecture red lines.

### Client Compatibility

| Client | Status | Notes |
|--------|--------|-------|
| **OpenCode Web UI** (browser) | ✔ Full support | Portal nav bar injected; instance switching via dropdown |
| **WhisperCode** (iOS/Android) | ✔ Supported | Uses Basic Auth with `sharedSecret`; connect to `<id>.<baseDomain>` directly |
| **OpenCode Desktop** (Tauri) | ✔ Supported | Same as browser; CORS preflight passthrough |
| **VS Code extension** | ✔ Supported | Standard HTTP/WS proxy |

**Known limitation:** Instance switching via the OC Portal dropdown only works in the browser Web UI. Native/mobile clients must manually update the server URL to switch instances. This is because the Portal nav bar is injected into proxied HTML and is not available in native app UIs.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Configure Gateway (copy template)
cp data/config.yaml.example data/config.yaml
# Edit data/config.yaml: gateway.baseDomain, gateway.sharedSecret (optional)
# Default baseDomain: localhost; use a public apex domain for production (see docs/npm-setup.md)

# Configure Agent (one per VM, via environment variables)
# AGENT_REGISTRATION_TOKEN=ocp-at-... GATEWAY_URL=ws://...
# AGENT_TARGET_HOST=127.0.0.1 AGENT_TARGET_PORT=4096

# Start Gateway
pnpm dev:server

# Start Agent on each VM
pnpm dev:agent

# Open Dashboard
open http://localhost:8080/
```

### Production Deployment

```bash
# Build
pnpm build

# Gateway (Docker Compose) — build locally
docker compose -f docker-compose.gateway.yml up -d --build

# Agent (Docker Compose) — build locally
docker compose -f docker-compose.agent.yml up -d --build
```

> NPM reverse proxy setup → [`docs/npm-setup.md`](docs/npm-setup.md)

---

## Project Structure

```
src/
├── shared/                  # Shared types, protocol, logging, tracing
├── server/                  # Gateway Server
│   ├── index.ts             # Entry point
│   ├── config.ts            # YAML config loading + env substitution
│   ├── registry.ts          # In-memory instance registry
│   ├── tunnel.ts            # WSS server (token verification, message routing)
│   ├── router.ts            # HTTP orchestration: apex routes + subdomain proxy/WS
│   ├── auth/                # AuthGate, browser login/OIDC routes, OIDC client
│   ├── http/                # Host parsing, cookie/body primitives, static routes
│   ├── proxy/               # Subdomain HTTP/WS proxy, response transforms, CSP/nav injection
│   ├── webui/               # Dashboard/Login SSR + static assets
│   ├── api/                 # /api/instances CRUD + deploy instructions
│   └── i18n/                # Locale detection, typed translation packs
├── agent/                   # Agent process
│   ├── index.ts             # Entry point
│   ├── config.ts            # YAML config loading
│   ├── tunnel.ts            # WSS client (registration, heartbeat, exponential backoff)
│   └── forwarder.ts         # Raw HTTP forwarding → localhost:4096 (SSE multi-frame)
data/config.yaml.example     # Gateway config template
Dockerfile.gateway           # Gateway production image
Dockerfile.agent             # Agent production image
tests/
  e2e.sh                     # Shell E2E tests
  playwright/                # Browser E2E tests
```

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Node.js + TypeScript | tsx for dev, tsc for build |
| HTTP | Node.js `http` (zero framework) | Dashboard is server-rendered HTML |
| WebSocket | `ws` | Stable, native protocol |
| Tunnel protocol | Custom JSON/Binary over WSS | Control + data share a single connection |
| Config | YAML + `${ENV}` substitution | Intuitive, supports env vars |
| Storage | In-memory registry + JSONC file | Gateway state persisted to `data/state.jsonc` |
| Auth | sharedSecret Bearer/Basic + OIDC SSO | Break-glass + enterprise SSO |

---

## Documentation

- [CONTEXT.md](./CONTEXT.md) — Glossary & connection model
- [AGENTS.md](./AGENTS.md) — Architecture red lines & conventions
- [docs/adr/README.md](./docs/adr/README.md) — Architecture Decision Record index
- [docs/npm-setup.md](./docs/npm-setup.md) — NPM reverse proxy configuration
- [docs/authentik-sso.md](./docs/authentik-sso.md) — Authentik OIDC SSO setup
- [docs/setup-guide/](./docs/setup-guide/) — Deployment setup guides
- [docs/ui-design-standard.md](./docs/ui-design-standard.md) — Portal UI and injected-host contracts
- [docs/icon-design-standard.md](./docs/icon-design-standard.md) — Portal SVG icon standard
- [docs/i18n-standard.md](./docs/i18n-standard.md) — Locale and translation standard
- [Portainer](https://docs.portainer.io/) — Architecture inspiration
