# OpenCode Portal

> 多台 VM/VPS 上 OpenCode Server 的统一入口——实例发现、Token 认证、反向代理、安全外部访问。

[English](../../README.md)

## 一句话

走到一个 URL，选实例干活，不管 OpenCode 跑在哪台机器上。

## 解决的问题

- 多台 dev VM 各跑一个 OpenCode，入口分散，记不住 IP/端口
- 每台单独配鉴权，重复劳动
- 没有统一的状态视图
- 无法安全地将实例暴露到公网，每台 VM 都得开端口

## 架构

参考 Portainer Edge Agent 模型，每台 VM 跑一个轻量 Agent，**主动**发起 WSS 连接 Gateway。VM 零入站端口。

```
Browser ──→ Gateway ←── WSS 隧道 ──→ Agent → OpenCode:4096
  App         │ (选择器)  (Agent 主动连)     (仅本地监听)
              │
              ├─ portal.example.com           → 仪表板 (apex)
              ├─ <sub>.portal.example.com     → OpenCode 实例 (子域代理)
              ├─ /login                       → 统一登录页（OIDC + 密钥）
              └─ /auth/*                      → Authentik OIDC SSO
```

TLS 由前置 NPM（Nginx Proxy Manager）终结，Gateway 内部只处理 ws。

**安全收益：**
- VM 零入站端口，不做攻击面
- 攻破 Gateway 也无法横向扫描 LAN
- Agent 只暴露指定服务

### 代理页集成

Gateway 在代理 OpenCode HTML 时注入顶栏 **OC Portal** 下拉菜单：

| 机制 | 说明 |
|------|------|
| `injectNavBar()` | 在 OpenCode 标题栏右侧挂载 Portal 按钮（OC Portal 位于原生按钮左侧），下拉菜单复用 OpenCode 主题 |
| `patchCspForScript()` | 将注入脚本的 sha256 加入 CSP 响应头白名单（修补 script-src 与 script-src-elem） |
| `patchCspInHtml()` | 修补 HTML 内 `<meta>` CSP 标签 |
| `overrideCacheHeaders()` | 代理响应设 `Cache-Control: no-cache`（保留 ETag 供 304） |
| 子域路由 | `<id>.<baseDomain>`；Gateway 按 `Host` 分流 |
| 代理体限制 | 缓冲型请求/响应各 50 MiB 上限（SSE 流式除外） |

详见 [CONTEXT.md](../../CONTEXT.md) 术语表与 [AGENTS.md](../../AGENTS.md) 红线。

### 客户端兼容性

| 客户端 | 状态 | 说明 |
|--------|------|------|
| **OpenCode Web UI**（浏览器） | ✔ 完整支持 | Portal 顶栏注入，下拉菜单切换实例 |
| **WhisperCode**（iOS/Android） | ✔ 支持 | 通过 Basic Auth 使用 `sharedSecret`；直接连接 `<id>.<baseDomain>` |
| **OpenCode Desktop**（Tauri） | ✔ 支持 | 与浏览器相同；CORS 预检放行 |
| **VS Code 扩展** | ✔ 支持 | 标准 HTTP/WS 代理 |

**已知限制：** OC Portal 下拉菜单的实例切换功能仅在浏览器 Web UI 中可用。原生客户端和移动 App 需手动修改服务器 URL 来切换实例——Portal 顶栏注入的是 HTML 脚本，不在原生 App UI 中显示。

---

## 快速开始

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test

# Gateway 配置（复制模板）
cp data/config.yaml.example data/config.yaml
# 编辑 data/config.yaml：gateway.baseDomain、gateway.sharedSecret（可选）
# 本地默认 baseDomain: localhost；生产须设为公网 apex 域名

# Agent 端配置（每台 VM 一份，通过环境变量）
# AGENT_REGISTRATION_TOKEN=ocp-at-... GATEWAY_URL=ws://...
# AGENT_TARGET_HOST=127.0.0.1 AGENT_TARGET_PORT=4096

# 启动 Gateway
pnpm dev:server

# 每个 VM 上启动 Agent
pnpm dev:agent

# 打开 Dashboard
open http://localhost:8080/
```

### 生产部署

```bash
# 构建
pnpm build

# Gateway（Docker Compose，本地构建）
docker compose -f docker-compose.gateway.yml up -d --build

# Agent（Docker Compose，本地构建）
docker compose -f docker-compose.agent.yml up -d --build
```

> NPM 反代配置 → [`docs/npm-setup.md`](../npm-setup.md)

---

## 项目结构

```
src/
├── shared/                  # 共享类型、协议、日志、追踪
├── server/                  # Gateway Server
│   ├── index.ts             # 入口
│   ├── config.ts            # YAML 配置加载 + env 变量替换
│   ├── registry.ts          # 纯内存实例注册表
│   ├── tunnel.ts            # WSS 服务端（token 验证、消息路由）
│   ├── router.ts            # HTTP 编排：apex 路由 + 子域代理/WS
│   ├── auth/                # AuthGate、浏览器登录/OIDC 路由、OIDC 客户端
│   ├── http/                # Host 解析、cookie/body 原语、静态资源路由
│   ├── proxy/               # 子域 HTTP/WS 代理、响应变换、CSP/nav 注入
│   ├── webui/               # Dashboard/Login SSR + 静态资源
│   ├── api/                 # /api/instances CRUD + deploy
│   └── i18n/                # 语言检测、类型化翻译包
├── agent/                   # Agent 进程
│   ├── index.ts             # 入口
│   ├── config.ts            # YAML 配置加载
│   ├── tunnel.ts            # WSS 客户端（注册、心跳、指数退避重连）
│   └── forwarder.ts         # 原始 HTTP 转发 → localhost:4096（SSE 多帧流式）
data/config.yaml.example     # Gateway 配置模板
Dockerfile.gateway           # Gateway 生产镜像
Dockerfile.agent             # Agent 生产镜像
tests/
  e2e.sh                     # Shell E2E 测试
  playwright/                # 浏览器 E2E 测试
```

---

## 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js + TypeScript | tsx 开发，tsc 构建 |
| HTTP | Node.js `http`（零框架） | Dashboard 是 server 生成的 HTML |
| WebSocket | `ws` | 稳定，原生协议 |
| 隧道协议 | 自定义 JSON/Binary over WSS | 控制/数据共享同一连接 |
| 配置 | YAML + `${ENV}` 替换 | 直观，支持环境变量 |
| 存储 | 纯内存 registry + JSONC 文件 | Gateway 状态持久化到 `data/state.jsonc` |
| 认证 | sharedSecret Bearer/Basic + OIDC SSO | 后备密钥 + 企业 SSO |

---

## 文档

- [CONTEXT.md](../../CONTEXT.md) — 术语表与连接模型
- [AGENTS.md](../../AGENTS.md) — 架构红线与编码规范
- [docs/adr/](../adr/) — 架构决策记录
- [docs/npm-setup.md](../npm-setup.md) — NPM 反代配置指南
- [docs/authentik-sso.md](../authentik-sso.md) — Authentik OIDC SSO 配置
- [Portainer](https://docs.portainer.io/) — 架构灵感来源
