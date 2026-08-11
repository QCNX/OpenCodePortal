## 1. 安装 OpenCode Server

在目标 VM 上安装并运行 OpenCode headless server。

### systemd（推荐）

创建 systemd 用户级 unit 文件 `~/.config/systemd/user/opencode.service`：

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

启用并启动：

```bash
# 必须：启用 lingering，用户登出后服务仍保持运行并开机自启
sudo loginctl enable-linger YOUR_USER

systemctl --user daemon-reload
systemctl --user enable --now opencode
```

验证状态：

```bash
systemctl --user status opencode
```

> **提示：** 如需设置 HTTP Basic Auth，在 service 文件中取消注释并设置：
> ```
> Environment=OPENCODE_SERVER_USERNAME=your_user
> Environment=OPENCODE_SERVER_PASSWORD=your_password
> ```
> 然后在 Portal 创建实例时填入相同的用户名和密码，Gateway 会自动注入认证头。

### 手动运行

直接在前台或后台启动：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

如需 HTTP Basic Auth，添加 `--username` 和 `--password`：

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --username your_user --password your_password
```

> 手动运行时需自行处理进程守护（如 tmux、screen、nohup）。

## 2. 创建 Portal 实例

在 Portal Dashboard 中点击「+ 添加实例」创建实例：

- **实例名称**：任意可读名称（如 `Dev VM`）
- **实例标识**：自动生成或手动填写，将作为子域名（如 `dev` → `dev.portal.example.com`）
- **OpenCode 监听地址 / 监听端口**：Agent 转发目标，即本机 OpenCode Server 的地址和端口（默认 `127.0.0.1:4096`）
- **OpenCode 用户 / 密码**：若 Server 开启了 Basic Auth，填入对应凭据；密码字段为掩码输入，编辑时留空表示不修改

## 3. 部署 Agent

创建实例后，点击该实例行右侧的「部署」操作，打开部署弹窗。

弹窗会生成两种 Agent 部署方式：

- **Docker Run**：直接复制粘贴运行；挂载命名卷 `ocp-agent-<id>-data:/app/data`，容器重建后 Agent 身份不丢失
- **Compose & .env**：适合持久化部署（等效的 `agent-data` 卷）

两种方式都只包含 Agent 隧道配置，不会写入上游 OpenCode 凭据；该凭据仍保存在 Dashboard 实例和宿主机 `opencode serve` 配置中。

Agent 会自动连接 Gateway 并将请求转发到本机 OpenCode Server。

### 升级 Agent

再次打开部署弹窗，并选择当前使用的部署方式。每个页签都有独立的**升级指南**和自动生成的命令：

- **Docker Run**：拉取最新镜像，使用 Portal 当前配置替换已有容器，并检查容器状态。
- **Compose & .env**：需在保存 `docker-compose.yml` 和 `.env` 的目录中执行；命令只重新创建 Agent 服务，随后检查服务状态。

替换过程中 Agent 连接会短暂断开，随后自动重新连接。旧镜像不会被自动清理。

### 同机快速开始（可选）

当 Gateway 与 OpenCode Server 部署在同一台宿主机时，可使用 `docker-compose.local.yml` 一键启动 Gateway + Agent，避免手动运行两个 compose 文件。

**前提：**
- OpenCode Server 已在宿主机运行（`opencode serve --hostname 127.0.0.1 --port 4096`）
- 已在 Dashboard 创建实例并获取 `assignedToken`

**步骤：**

```bash
# 1. 准备配置
cp data/config.yaml.example data/config.yaml  # 编辑 Gateway 配置
cp .env.example .env                          # 填写环境变量

# 2. 在 .env 中设置 Agent 注册令牌（来自 Dashboard 部署弹窗的 assignedToken）
# AGENT_REGISTRATION_TOKEN=ocp-at-...

# 3. 一键启动 Gateway + Agent
docker compose -f docker-compose.local.yml up -d

# 4. 验证
curl http://localhost:8080/health
# Dashboard 应显示实例在线
```

**与分离式部署的差异：**
- 唯一特殊点是 Agent 使用 `network_mode: host` 访问宿主机 `127.0.0.1:4096`
- Gateway 行为与分离式完全相同；Agent 隧道协议不变
- **同机仍需 Agent**，不是 Gateway 直连 OpenCode（保持 Agent-only WSS 架构）

## 4. 访问实例

Agent 上线后（Dashboard 状态变为在线），通过子域名访问：

```
https://<instance-id>.<portal-domain>/
```

例如：`https://dev.portal.example.com/`

浏览器访问时会自动注入 OC Portal 导航栏，可随时切换实例或返回 Dashboard。

## 5. 移动端 App 连接（WhisperCode）

WhisperCode 等第三方 App 通过 HTTP Basic Auth 连接 OpenCode。启用 Portal 认证后，在 App 的「服务器密码」中填入 Portal 的 **`sharedSecret`**（用户名任意）：

- **服务器 URL**：`https://<实例标识>.<Portal域名>/`
- **用户名**：任意（如 `opencode`）
- **密码**：Portal `sharedSecret`（与 break-glass Bearer / `?token=` 相同）

OpenCode Server 需允许 App WebView 的 CORS 预检，否则请求会在 OPTIONS 阶段失败：

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --cors "tauri://localhost"
```

仅在可信开发环境使用 `--cors "*"`。Portal 会使用 Dashboard 实例上配置的 **OpenCode 用户 / 密码** 重写上游凭据。

> **重要：** WhisperCode 内置的 **管理服务器** 对话框执行的是应用内热切换，**不会**清理已打开的工作区或标签页。在 Portal 实例之间切换时（如 `dev01` → `openclaw`），App 可能继续使用上一个实例的文件系统路径向新服务器发送 API 请求，导致 `500` 错误。**解决方法：** 在管理服务器中切换实例**之前**，先关闭 WhisperCode 中所有已打开的工作区/标签页。浏览器用户使用 OC Portal 导航栏**不受影响** — OC Portal 按钮会导航到新实例的全新页面。

## 6. 排查上游 401 错误

如果 Portal 登录或 App 认证已经成功，但浏览器终端、App 终端或 API 返回 `401`，请检查上游 OpenCode 凭据：

1. 检查宿主机上 `opencode serve` 的启动方式，确认 `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` 或 `--username` / `--password` 参数。
2. 在 Portal Dashboard 编辑对应实例，将 **OpenCode 用户 / 密码** 设置为相同值。
3. 重新请求。Gateway 会在转发 HTTP 与 PTY WebSocket 流量时注入这些 Dashboard 凭据。

App 的服务器密码仍应填写 Portal `sharedSecret`，不是上游 OpenCode 密码。Agent 容器环境变量不会配置宿主机 `opencode serve` 的鉴权。
