# Nginx Proxy Manager (NPM) — Reverse Proxy Configuration

NPM sits in front of the Gateway, handling TLS termination (optional for
LAN) and providing a web UI for proxy management. The Gateway listens on
a raw HTTP+WS port; NPM forwards traffic to it.

Gateway routes by **Host header**:
- **Apex** `portal.example.com` → Dashboard, login, health
- **Instances** `<subdomain>.portal.example.com` → proxied OpenCode

You need **two proxy hosts** (or one wildcard) pointing at the same Gateway upstream.

## Quick Setup

### 1. Apex — Dashboard

| Field | Value |
|-------|-------|
| Domain Names | `portal.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1` (or Gateway host IP) |
| Forward Port | `8080` |
| Enable WebSocket Support | ✅ Yes |
| Preserve Host Header | ✅ Yes (default) |

### 2. Wildcard — All instance subdomains

| Field | Value |
|-------|-------|
| Domain Names | `*.portal.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | same as apex |
| Forward Port | `8080` |
| Enable WebSocket Support | ✅ Yes |
| Preserve Host Header | ✅ Yes |

Set `gateway.baseDomain: portal.example.com` in Gateway `config.yaml` and give
each instance a unique ID; the ID is its subdomain (e.g. `dev` → `dev.portal.example.com`).

### Generated Nginx (conceptual)

```nginx
# Apex — Dashboard
server {
  listen 443 ssl;
  server_name portal.example.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}

# Wildcard — instance subdomains
server {
  listen 443 ssl;
  server_name *.portal.example.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

## TLS / Wildcard Certificate

For HTTPS on both apex and `*.portal.example.com`:

1. In NPM, request a **wildcard** Let's Encrypt cert for `*.portal.example.com`
   (DNS challenge), **or** use a cert that covers both apex and wildcard SANs.
2. Attach the cert to **both** proxy hosts above.
3. Enable **Force SSL** on each host.
4. **No changes needed on the Gateway** — TLS terminates at NPM.

Local dev: set `baseDomain: localhost` — browsers resolve `*.localhost` without DNS.

## How WebSocket Works

NPM automatically sends `Upgrade` and `Connection` headers through to
the Gateway. No additional NPM configuration is needed — toggling
"WebSocket Support" in the proxy host settings is enough.

The Gateway itself handles:
- Agent WSS connections (`/agent/connect`)
- Browser WS connections on instance subdomains (PTY terminal, etc.)
- SSO auth (`ocp_auth` or `ocp_session` cookie scoped to `.baseDomain`) for WS upgrades

## Access Control

For LAN use, restrict access by IP in the NPM proxy host settings:

1. Edit the proxy host → **Advanced** tab
2. Add custom Nginx configuration:

   ```nginx
   # Allow only LAN IPs
   allow 192.168.0.0/16;
   allow 10.0.0.0/8;
   allow 172.16.0.0/12;
   deny all;
   ```

3. Alternatively, configure the Gateway's `sharedSecret` to require
   authentication for all proxied requests (dashboard + instance subdomains).
4. For single-user SSO, configure `gateway.oidc` (Authentik) — the `/auth/*`
   routes live on the apex and need no special NPM blocks. See
   [authentik-sso.md](authentik-sso.md).

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` | Gateway not running, or upstream response > 50 MiB (non-SSE) | `systemctl --user status opencode-portal`; large non-SSE responses hit Agent limit |
| `413 Payload Too Large` | Proxy request body > 50 MiB | Reduce upload size or bypass Gateway for large transfers |
| WS connection fails | NPM WebSocket support off | Enable "WebSocket Support" on wildcard host |
| Wrong instance / 404 subdomain | Instance ID mismatch or missing wildcard host | Check the Dashboard instance ID and NPM `*.baseDomain` host |
| Dashboard OK but instances 404 | Wildcard proxy host missing | Add `*.portal.example.com` proxy host |
| 404 on apex and all subdomains | `gateway.baseDomain` ≠ Host NPM sends | Set `baseDomain` to public apex (e.g. `ocp.example.com`); grep Gateway logs for `route_not_found unknown host` |
| Private IP (`http://10.x.x.x:8080/`) redirects to login | Private IPs are treated as development apex hosts | Authenticate normally; cookies are host-only on development hosts |
| Public IP or unrelated public Host returns 404 | Host does not match `baseDomain` | Use the configured apex/subdomain URL; `/health` remains host-independent |
| Slow dashboard updates | Proxy buffering | NPM advanced config: `proxy_buffering off;` |
| `Host` header mismatch | NPM rewriting Host | Ensure "Preserve Host Header" is on |
| Login works on apex but not subdomains | Cookie domain or missing forwarded HTTPS scheme | Preserve `Host` and `X-Forwarded-Proto`; Gateway sets `Domain=.<baseDomain>` only for matching apex/subdomains |
