## 1. Install OpenCode Server

Install and run the OpenCode headless server on your target VM.

### systemd (Recommended)

Create a user-level systemd unit file at `~/.config/systemd/user/opencode.service`:

```service
[Unit]
Description=OpenCode headless server
After=network.target

[Service]
Type=simple
ExecStart=%h/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 4096
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:

```bash
# Required: enable lingering so the service keeps running after logout and starts at boot
sudo loginctl enable-linger YOUR_USER

systemctl --user daemon-reload
systemctl --user enable --now opencode
```

Verify status:

```bash
systemctl --user status opencode
```

> **Tip:** To enable HTTP Basic Auth, uncomment and set in the service file:
> ```
> Environment=OPENCODE_SERVER_USERNAME=your_user
> Environment=OPENCODE_SERVER_PASSWORD=your_password
> ```
> Then enter the same credentials when creating the Portal instance — the Gateway will inject the auth header automatically.

### Manual Run

Start the server directly:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

For HTTP Basic Auth, add `--username` and `--password`:

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --username your_user --password your_password
```

> You will need to manage the process yourself (e.g. tmux, screen, nohup).

## 2. Create Portal Instance

Click "+ Add Instance" on the Portal Dashboard:

- **Instance Name**: A readable name (e.g. `Dev VM`)
- **Instance ID**: Auto-generated or manual — becomes the subdomain (e.g. `dev` → `dev.portal.example.com`)
- **OpenCode Listen Address / Port**: Where the Agent forwards traffic — local OpenCode Server host and port (default `127.0.0.1:4096`)
- **OpenCode User / Password**: If the server has Basic Auth enabled, enter credentials here; password is masked and left blank on edit to keep the existing value

## 3. Deploy Agent

After creating the instance, click the Deploy action on the instance row to open the Deploy modal.

The modal generates two deployment options:

- **Docker Run**: Copy-paste and run directly; mounts a named volume (`ocp-agent-<id>-data:/app/data`) so Agent identity persists across container recreation
- **Compose & .env**: For persistent deployments (equivalent `agent-data` volume)

Both options contain only Agent tunnel settings. They intentionally omit upstream OpenCode credentials, which remain in the Dashboard instance and the host `opencode serve` configuration.

The Agent will auto-connect to the Gateway and forward requests to your local OpenCode Server.

### Upgrade the Agent

Open the Deploy modal again and select the deployment method currently in use. Each tab contains a dedicated **Upgrade Guide** and a generated command:

- **Docker Run** pulls the latest image, replaces the existing container with the current Portal settings, and checks the resulting container status.
- **Compose & .env** must be run from the directory containing `docker-compose.yml` and `.env`; it pulls and recreates only the Agent service, then checks its status.

The Agent connection will disconnect briefly during replacement and reconnect automatically. Old images are not removed automatically.

### Same-Machine Quick Start (Optional)

When the Gateway and OpenCode Server run on the same host, use `docker-compose.local.yml` to start Gateway + Agent with a single command instead of running two compose files.

**Prerequisites:**
- OpenCode Server is running on the host (`opencode serve --hostname 127.0.0.1 --port 4096`)
- An instance has been created in Dashboard and you have copied its `assignedToken`

**Steps:**

```bash
# 1. Prepare configuration
cp data/config.yaml.example data/config.yaml  # Edit Gateway config
cp .env.example .env                          # Fill in environment variables

# 2. In .env, set the Agent registration token (the assignedToken from Dashboard deploy modal)
# AGENT_REGISTRATION_TOKEN=ocp-at-...

# 3. Start Gateway + Agent with a single command
docker compose -f docker-compose.local.yml up -d

# 4. Verify
curl http://localhost:8080/health
# Dashboard should show the instance as online
```

**Differences from separate deployment:**
- The only special aspect is the Agent using `network_mode: host` to reach the host's `127.0.0.1:4096`
- Gateway behavior is identical to separate deployment; the Agent tunnel protocol is unchanged
- **The same-machine setup still requires an Agent** — this is not a Gateway-direct-to-OpenCode mode (preserving the Agent-only WSS architecture)

## 4. Access Your Instance

Once the Agent is online (Dashboard status shows "online"), access it via the subdomain:

```
https://<instance-id>.<portal-domain>/
```

Example: `https://dev.portal.example.com/`

Browser access will inject the OC Portal navigation bar, so you can switch instances or return to the Dashboard anytime.

## 5. Mobile App Connection (WhisperCode)

Third-party apps such as [WhisperCode](https://github.com/DNGriffin/whispercode) connect to OpenCode via HTTP Basic Auth. When Portal auth is enabled, use your Portal **`sharedSecret`** as the app server password (username can be anything):

- **Server URL**: `https://<instance-id>.<portal-domain>/`
- **Username**: any value (e.g. `opencode`)
- **Password**: Portal `sharedSecret` (same as break-glass Bearer / `?token=`)

On the OpenCode Server host, enable CORS for the app WebView origin so preflight requests succeed:

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --cors "tauri://localhost"
```

Use `--cors "*"` only in trusted dev environments. Portal rewrites upstream credentials using the instance **OpenCode User / Password** fields configured on the Dashboard.

> **Important:** WhisperCode's built-in **Manage servers** dialog performs an in-app hot-switch that does **not** clear open workspaces or tabs. When switching between Portal instances (e.g. `dev01` → `openclaw`), the app may continue sending API requests with the previous instance's filesystem path against the new server, causing `500` errors. **Workaround:** close all open workspaces/tabs in WhisperCode **before** switching instances in Manage servers. Browser users using the OC Portal nav bar are **not affected** — the OC Portal button navigates to a fresh page on the new instance.

## 6. Troubleshoot Upstream 401 Errors

If Portal login or App authentication succeeds but the browser terminal, App terminal, or API returns `401`, check the upstream OpenCode credentials:

1. Check how `opencode serve` is started on the host. Note its `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` values or `--username` / `--password` flags.
2. Edit the instance in the Portal Dashboard and set **OpenCode User / Password** to the same values.
3. Retry the request. The Gateway injects these Dashboard credentials when forwarding HTTP and PTY WebSocket traffic.

The App's server password remains the Portal `sharedSecret`; it is not the upstream OpenCode password. Agent container environment variables do not configure the host's `opencode serve` authentication.
