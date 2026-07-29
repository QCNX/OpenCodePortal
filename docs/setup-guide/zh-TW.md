## 1. 安裝 OpenCode Server

在目標 VM 上安裝並執行 OpenCode headless server。

### systemd（建議）

建立 systemd unit 檔案 `/etc/systemd/system/opencode.service`：

```service
[Unit]
Description=OpenCode headless server
After=network.target

[Service]
Type=simple
User=YOUR_USER
ExecStart=/home/YOUR_USER/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 4096
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

啟用並啟動：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opencode
```

確認狀態：

```bash
sudo systemctl status opencode
```

> **提示：** 如需設定 HTTP Basic Auth，請在 service 檔案中取消註解並設定：
> ```
> Environment=OPENCODE_SERVER_USERNAME=your_user
> Environment=OPENCODE_SERVER_PASSWORD=your_password
> ```
> 接著在 Portal 建立執行個體時填入相同的使用者名稱與密碼，Gateway 會自動注入驗證標頭。

### 手動執行

直接在前景或背景啟動：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

如需 HTTP Basic Auth，請加入 `--username` 與 `--password`：

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --username your_user --password your_password
```

> 手動執行時需自行管理程序（例如 tmux、screen、nohup）。

## 2. 建立 Portal 執行個體

在 Portal Dashboard 中點選「+ 新增執行個體」：

- **執行個體名稱**：任意易讀名稱（例如 `Dev VM`）
- **執行個體識別碼**：自動產生或手動輸入，將作為子網域（例如 `dev` → `dev.portal.example.com`）
- **OpenCode 監聽位址 / 監聽連接埠**：Agent 的轉送目標，也就是本機 OpenCode Server 的位址與連接埠（預設 `127.0.0.1:4096`）
- **OpenCode 使用者 / 密碼**：若 Server 已啟用 Basic Auth，請填入對應憑證；密碼欄位會遮罩，編輯時留空表示維持原值

## 3. 部署 Agent

建立執行個體後，點選該列右側的「部署」操作開啟部署視窗。

視窗會產生兩種 Agent 部署方式：

- **Docker Run**：直接複製並執行；掛載命名卷 `ocp-agent-<id>-data:/app/data`，容器重建後 Agent 身份不丟失
- **Compose & .env**：適合持久化部署（等效的 `agent-data` 卷）

兩種方式都只包含 Agent 通道設定，不會寫入上游 OpenCode 憑證；該憑證仍保存在 Dashboard 執行個體與主機 `opencode serve` 設定中。

Agent 會自動連線至 Gateway，並將請求轉送至本機 OpenCode Server。

### 升級 Agent

再次開啟部署視窗，並選擇目前使用的部署方式。每個頁籤都有獨立的**升級指南**與自動產生的命令：

- **Docker Run**：拉取最新映像，使用 Portal 目前設定替換既有容器，並檢查容器狀態。
- **Compose & .env**：需在存放 `docker-compose.yml` 與 `.env` 的目錄中執行；命令只重新建立 Agent 服務，隨後檢查服務狀態。

替換期間 Agent 連線會短暫中斷，隨後自動重新連線。舊映像不會自動清理。

### 同機快速開始（可選）

當 Gateway 與 OpenCode Server 部署在同一台宿主機時，可使用 `docker-compose.local.yml` 一鍵啟動 Gateway + Agent，避免手動執行兩個 compose 檔案。

**前提：**
- OpenCode Server 已在宿主機執行（`opencode serve --hostname 127.0.0.1 --port 4096`）
- 已在 Dashboard 建立執行個體並取得 `assignedToken`

**步驟：**

```bash
# 1. 準備設定
cp data/config.yaml.example data/config.yaml  # 編輯 Gateway 設定
cp .env.example .env                          # 填寫環境變數

# 2. 在 .env 中設定 Agent 註冊權杖（來自 Dashboard 部署彈窗的 assignedToken）
# AGENT_REGISTRATION_TOKEN=ocp-at-...

# 3. 一鍵啟動 Gateway + Agent
docker compose -f docker-compose.local.yml up -d

# 4. 驗證
curl http://localhost:8080/health
# Dashboard 應顯示執行個體在線
```

**與分離式部署的差異：**
- 唯一特殊點是 Agent 使用 `network_mode: host` 存取宿主機 `127.0.0.1:4096`
- Gateway 行為與分離式完全相同；Agent 隧道協定不變
- **同機仍需要 Agent**，不是 Gateway 直連 OpenCode（保持 Agent-only WSS 架構）

## 4. 存取執行個體

Agent 上線後（Dashboard 狀態顯示為線上），可透過子網域存取：

```
https://<instance-id>.<portal-domain>/
```

例如：`https://dev.portal.example.com/`

瀏覽器存取時會自動注入 OC Portal 導覽列，可隨時切換執行個體或返回 Dashboard。

## 5. 行動端 App 連線（WhisperCode）

WhisperCode 等第三方 App 透過 HTTP Basic Auth 連線 OpenCode。啟用 Portal 認證後，在 App 的「伺服器密碼」填入 Portal 的 **`sharedSecret`**（使用者名稱任意）：

- **伺服器 URL**：`https://<執行個體識別>.<Portal網域>/`
- **使用者名稱**：任意（如 `opencode`）
- **密碼**：Portal `sharedSecret`（與 break-glass Bearer / `?token=` 相同）

OpenCode Server 需允許 App WebView 的 CORS 預檢，否則請求會在 OPTIONS 階段失敗：

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --cors "tauri://localhost"
```

僅在可信開發環境使用 `--cors "*"`。Portal 會使用 Dashboard 執行個體上設定的 **OpenCode 使用者 / 密碼** 重寫上游憑據。

> **重要：** WhisperCode 內建的 **管理伺服器** 對話框執行的是應用內熱切換，**不會**清理已開啟的工作區或分頁。在 Portal 執行個體之間切換時（如 `dev01` → `openclaw`），App 可能繼續使用上一個執行個體的檔案系統路徑向新伺服器發送 API 請求，導致 `500` 錯誤。**解決方法：** 在管理伺服器中切換執行個體**之前**，先關閉 WhisperCode 中所有已開啟的工作區/分頁。瀏覽器使用者使用 OC Portal 導覽列**不受影響** — OC Portal 按鈕會導航到新執行個體的全新頁面。

## 6. 排查上游 401 錯誤

如果 Portal 登入或 App 驗證已成功，但瀏覽器終端、App 終端或 API 回傳 `401`，請檢查上游 OpenCode 憑證：

1. 檢查主機上 `opencode serve` 的啟動方式，確認 `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` 或 `--username` / `--password` 參數。
2. 在 Portal Dashboard 編輯對應執行個體，將 **OpenCode 使用者 / 密碼** 設為相同值。
3. 重新發出請求。Gateway 會在轉送 HTTP 與 PTY WebSocket 流量時注入這些 Dashboard 憑證。

App 的伺服器密碼仍應填入 Portal `sharedSecret`，不是上游 OpenCode 密碼。Agent 容器環境變數不會配置主機 `opencode serve` 的驗證。
