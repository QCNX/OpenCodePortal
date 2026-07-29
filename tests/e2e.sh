#!/usr/bin/env bash
# OpenCode Portal — End-to-End Test Suite
# Requires: pnpm build completed (dist/ exists)
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0
pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1 — $2"; FAIL=$((FAIL+1)); }

# Fetch an authenticated dashboard into a file, retrying until a COMPLETE document
# is received. This avoids CI flakiness where a partial/early response under runner
# load passes a naive "OpenCode Portal" check but is missing later markup. We write
# to a file (not a $(...) capture, which mangles bytes/NULs) and grep the file
# byte-exactly under LC_ALL=C so multibyte (zh) patterns match deterministically.
# Usage: fetch_dashboard <outfile> <host>  -> 0 if a complete dashboard was fetched.
fetch_dashboard() {
  local out="$1" host="$2" i
  for i in $(seq 1 15); do
    if curl -s --max-time 5 -H "Authorization: Bearer e2e-secret" -H "Host: $host" \
         "http://localhost:19080/" -o "$out" 2>/dev/null \
       && LC_ALL=C grep -q 'OpenCode Portal' "$out" \
       && LC_ALL=C grep -q '</html>' "$out"; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# ---- Setup ----
TMPDIR=$(mktemp -d)
trap "kill \$(jobs -p) 2>/dev/null || true; rm -rf $TMPDIR" EXIT

echo -e "${CYAN}=== OpenCode Portal E2E Tests ===${NC}"

# Build if needed
if [ ! -f dist/server/index.js ]; then
  echo "Building..."
  pnpm build > /dev/null 2>&1
fi

# ---- Config files ----
cat > "$TMPDIR/gateway.yaml" << 'EOF'
gateway:
  port: 19080
  host: "0.0.0.0"
  baseDomain: "localhost"
  sharedSecret: "e2e-secret"
EOF

# ---- Start echo server ----
echo ""
echo "Starting services..."
PORT=13001 node tests/e2e-echo-server.cjs > "$TMPDIR/echo.log" 2>&1 &
ECHO_PID=$!
for i in $(seq 1 20); do
  curl -s "http://127.0.0.1:13001/api/test" > /dev/null 2>&1 && break
  sleep 0.2
done
if ! curl -s "http://127.0.0.1:13001/api/test" | grep -q '"ok":true'; then
  echo "Echo server failed to start:" >&2
  cat "$TMPDIR/echo.log" >&2
  exit 1
fi

# ---- Start gateway ----
export PORTAL_DATA_DIR="$TMPDIR/gw-data"
node dist/server/index.js "$TMPDIR/gateway.yaml" > "$TMPDIR/gw.log" 2>&1 &
GW_PID=$!
# Wait for gateway to be ready
for i in $(seq 1 10); do
  curl -s http://localhost:19080/health > /dev/null 2>&1 && break
  sleep 0.3
done

# ---- Create instance via API ----
# Create e2e-vm instance
CREATE_RESP=$(curl -s -X POST -H "Authorization: Bearer e2e-secret" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"e2e-vm\",\"name\":\"E2E VM\",\"tags\":[\"e2e\"]}" \
  "http://localhost:19080/api/instances")
ASSIGNED_TOKEN=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['assignedToken'])" 2>/dev/null)

if [ -z "$ASSIGNED_TOKEN" ]; then
  echo "Failed to create e2e-vm instance via API:" >&2
  echo "$CREATE_RESP" >&2
  cat "$TMPDIR/gw.log" >&2
  exit 1
fi

echo "Instance created: e2e-vm, token: ${ASSIGNED_TOKEN:0:7}..."

# ---- Agent config ----
cat > "$TMPDIR/agent.yaml" << YEOF
gateway:
  url: "ws://localhost:19080/agent/connect"
registrationToken: "$ASSIGNED_TOKEN"
targetHost: "127.0.0.1"
targetPort: 13001
reconnect:
  baseDelayMs: 500
  maxDelayMs: 2000
heartbeat:
  intervalMs: 5000
YEOF

# ---- Start agent ----
export PORTAL_DATA_DIR="$TMPDIR/agent-data"
PORTAL_DATA_DIR="$TMPDIR/agent-data" node dist/agent/index.js "$TMPDIR/agent.yaml" > "$TMPDIR/agent.log" 2>&1 &
AGENT_PID=$!
sleep 2

echo ""
echo -e "${CYAN}--- Test Suite ---${NC}"

# ---- 1. Health endpoint ----
echo ""
echo "1. Health endpoint"
RESP=$(curl -s http://localhost:19080/health)
if echo "$RESP" | grep -q '"status":"ok"'; then
  pass "GET /health → 200"
else
  fail "GET /health → 200" "got: $RESP"
fi

ONLINE=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['online'])" 2>/dev/null || echo 0)
if [ "$ONLINE" -ge 1 ]; then
  pass "Health reports online instances: $ONLINE"
else
  fail "Health reports online instances" "got: $ONLINE"
fi

# ---- 2. Agent registration ----
echo ""
echo "2. Agent registration"
if grep -q '"agent_register"' "$TMPDIR/agent.log"; then
  pass "Agent registered successfully"
else
  fail "Agent registered" "check $TMPDIR/agent.log"
fi

# ---- 3. Dashboard ----
echo ""
echo "3. Dashboard"
if fetch_dashboard "$TMPDIR/dash.html" localhost; then
  pass "Dashboard HTML served (auth OK)"
else
  fail "Dashboard served" "incomplete after retries ($(wc -c <"$TMPDIR/dash.html" 2>/dev/null || echo 0) bytes)"
fi

if LC_ALL=C grep -q '搜索实例名称' "$TMPDIR/dash.html" || LC_ALL=C grep -q 'Search instances' "$TMPDIR/dash.html"; then
  pass "Dashboard has search filter"
else
  fail "Dashboard search filter" "not found"
fi

if LC_ALL=C grep -q 'id="refreshStatus"' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data-portal-icon="refresh"' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'onclick="location.reload()"' "$TMPDIR/dash.html"; then
  pass "Dashboard has agent status refresh button"
else
  fail "Dashboard status refresh button" "not found"
fi

if LC_ALL=C grep -q 'data-portal-icon="info"' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data-portal-icon="deploy"' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data-portal-icon="edit"' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data-portal-icon="delete"' "$TMPDIR/dash.html"; then
  pass "Dashboard uses the Portal SVG icon set"
else
  fail "Dashboard SVG icon set" "one or more icons not found"
fi

if LC_ALL=C grep -q 'deploy-method-tabs' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data.dockerUpgrade' "$TMPDIR/dash.html" && LC_ALL=C grep -q 'data.composeUpgrade' "$TMPDIR/dash.html"; then
  pass "Dashboard deploy modal includes Docker and Compose upgrade guides"
else
  fail "Dashboard deploy upgrade guides" "upgrade guide markup not found"
fi

if LC_ALL=C grep -q 'portal-chip' "$TMPDIR/dash.html"; then
  pass "Dashboard has tag filter"
else
  fail "Dashboard tag filter" "not found"
fi

# ---- 4. Auth required ----
echo ""
echo "4. Auth enforcement"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: localhost" http://localhost:19080/)
if [ "$CODE" = "302" ]; then
  pass "Unauthenticated dashboard → 302 /login"
else
  fail "Unauthenticated → 401" "got $CODE"
fi

# ---- 5. HTTP proxy ----
echo ""
echo "5. HTTP proxy"
RESP=$(curl -s -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" http://localhost:19080/test)
if echo "$RESP" | grep -q '"ok":true'; then
  pass "HTTP proxy → echo response OK"
else
  fail "HTTP proxy" "got: $RESP"
fi

# ---- 6. WebSocket proxy ----
echo ""
echo "6. WebSocket proxy"
WS_RESULT=$(node -e "
const WebSocket=require('ws');
const ws=new WebSocket('ws://localhost:19080/?token=e2e-secret', {
  headers: { Host: 'e2e-vm.localhost' }
});
ws.on('open',()=>{ws.send('ping');setTimeout(()=>ws.close(),2000)});
ws.on('message',d=>{console.log(d.toString());ws.close()});
ws.on('close',()=>process.exit(0));
ws.on('error',e=>{console.error('ws error:',e.message);process.exit(1)});
setTimeout(()=>process.exit(2),3000);
" 2>&1 || true)

if echo "$WS_RESULT" | grep -q 'echo:ping'; then
  pass "WS proxy → echo response OK"
else
  fail "WS proxy" "got: $WS_RESULT"
fi

# ---- 6b. Subdomain routing ----
echo ""
echo "6b. Subdomain routing"

# 6b.1: Access e2e-vm.localhost root → proxy upstream /
INSTANCE_ROOT=$(curl -s -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" "http://localhost:19080/")
if echo "$INSTANCE_ROOT" | grep -q '"ok":true'; then
  pass "e2e-vm.localhost proxies instance root"
else
  fail "e2e-vm.localhost direct proxy" "got: $(echo $INSTANCE_ROOT | head -c 80)"
fi

# 6b.2: Apex / remains Dashboard (no instance cookie routing)
if fetch_dashboard "$TMPDIR/apex.html" localhost; then
  pass "/ on apex remains dashboard"
else
  fail "/ apex dashboard" "got: $(head -c 80 "$TMPDIR/apex.html" 2>/dev/null)"
fi

# 6b.3: Subdomain /api/test should proxy
IMPLICIT=$(curl -s -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" http://localhost:19080/api/test)
if echo "$IMPLICIT" | grep -q '"ok":true'; then
  pass "Subdomain /api/test → echo OK"
else
  fail "Subdomain routing" "got: $IMPLICIT"
fi

# 6b.4: Subdomain routing preserves query string
QS_RESP=$(curl -s -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" "http://localhost:19080/api/test?q=hello")
if echo "$QS_RESP" | grep -q '"url":"/api/test?q=hello"'; then
  pass "Subdomain routing preserves query string"
else
  fail "Query string passthrough" "got: $QS_RESP"
fi

# ---- 6c. Login page ----
echo ""
echo "6c. Login page"

# 6c.1: GET /login → HTML form
LOGIN_HTML=$(curl -s http://localhost:19080/login)
if echo "$LOGIN_HTML" | grep -q 'method="POST"'; then
  pass "GET /login → login form HTML"
else
  fail "GET /login" "no form found"
fi

# 6c.2: POST /login with correct secret → 302 + Set-Cookie
POST_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -D "$TMPDIR/login_headers.txt" -X POST -d "secret=e2e-secret" http://localhost:19080/login)
if [ "$POST_RESULT" = "302" ]; then
  pass "POST /login (correct) → 302"
else
  fail "POST /login 302" "got $POST_RESULT"
fi

if grep -q 'Domain=.localhost' "$TMPDIR/login_headers.txt"; then
  pass "POST /login sets SSO cookie Domain=.localhost"
else
  fail "POST /login SSO domain" "Domain=.localhost not found"
fi

# 6c.3: POST /login with wrong secret → 200 (login form with error)
WRONG_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST -d "secret=wrong-secret" http://localhost:19080/login)
if [ "$WRONG_RESULT" = "200" ]; then
  pass "POST /login (wrong) → 200 (error)"
else
  fail "POST /login wrong → 200" "got $WRONG_RESULT"
fi

# 6c.4: legacy and standard language cookies render Traditional Chinese
LOGIN_ZHT=$(curl -s -H "Cookie: language=zht" http://localhost:19080/login)
if LC_ALL=C grep -q 'html lang="zh-TW"' <<< "$LOGIN_ZHT" && LC_ALL=C grep -q '登入以繼續' <<< "$LOGIN_ZHT"; then
  pass "GET /login honors legacy zht language cookie"
else
  fail "GET /login Traditional Chinese" "localized content not found"
fi

# ---- 6d. WS terminal echo ----
echo ""
echo "6d. WS terminal echo"

# Test WS data relay via subdomain Host + auth
WS_TERM=$(node -e "
const WebSocket=require('ws');
const ws=new WebSocket('ws://localhost:19080/echo?token=e2e-secret', {
  headers: { Host: 'e2e-vm.localhost' }
});
let result='';
ws.on('open',()=>{ws.send('hello-terminal');setTimeout(()=>ws.close(),1500)});
ws.on('message',d=>{result+=d.toString();ws.close()});
ws.on('close',()=>process.stdout.write(result));
ws.on('error',e=>{console.error('ws error:',e.message);process.exit(1)});
setTimeout(()=>process.exit(2),3000);
" 2>&1 || true)

if echo "$WS_TERM" | grep -q 'echo:hello-terminal'; then
  pass "WS terminal echo via subdomain Host OK"
else
  fail "WS terminal echo" "got: $WS_TERM"
fi

# ---- 6e. Nav bar injection ----
echo ""
echo "6e. Nav bar injection"

# Fetch proxied /html with injected nav script into a file, retrying until COMPLETE.
# Mirrors fetch_dashboard: file capture avoids $(...) truncation on large bodies under CI load.
# Usage: fetch_nav_html <outfile>  -> 0 if complete nav-injected HTML was fetched.
nav_resp_complete() {
  local f="$1"
  LC_ALL=C grep -q "nav.id='_ocp_nav'" "$f" \
    && LC_ALL=C grep -q 'opencode-titlebar-left' "$f" \
    && LC_ALL=C grep -q 'findVisibleTitlebarLeft' "$f" \
    && LC_ALL=C grep -q 'host.insertBefore(nav,host.firstChild)' "$f" \
    && LC_ALL=C grep -q "menu.setAttribute('data-component','dropdown-menu-content')" "$f" \
    && LC_ALL=C grep -q "switchItem.id='_ocp_switch'" "$f" \
    && LC_ALL=C grep -q "menu.id='_ocp_dropdown'" "$f" \
    && LC_ALL=C grep -q 'document.body.appendChild(submenuEl)' "$f" \
    && LC_ALL=C grep -q 'Hello E2E' "$f" \
    && LC_ALL=C grep -q '</html>' "$f"
}
fetch_nav_html() {
  local out="$1" i
  for i in $(seq 1 15); do
    if curl -s --max-time 10 -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" \
         "http://localhost:19080/html" -o "$out" 2>/dev/null \
       && nav_resp_complete "$out"; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
NAV_HTML="$TMPDIR/nav.html"
if fetch_nav_html "$NAV_HTML"; then
  pass "Nav bar HTML fetched completely"
else
  fail "Nav bar HTML fetch" "incomplete after 15 attempts (size=$(wc -c < "$NAV_HTML" 2>/dev/null || echo 0) bytes)"
fi

if LC_ALL=C grep -q "nav.id='_ocp_nav'" "$NAV_HTML"; then
  pass "Nav bar script injected into HTML response"
else
  fail "Nav bar injection" "not found"
fi

if LC_ALL=C grep -q 'opencode-titlebar-left' "$NAV_HTML"; then
  pass "Nav bar targets titlebar-left mount point"
else
  fail "Titlebar mount point" "not found"
fi

if LC_ALL=C grep -q 'findVisibleTitlebarLeft' "$NAV_HTML"; then
  pass "Nav bar uses visible titlebar detection"
else
  fail "Visible titlebar detection" "not found"
fi

if LC_ALL=C grep -q 'host.insertBefore(nav,host.firstChild)' "$NAV_HTML"; then
  pass "Nav bar prepends into titlebar-left (leftmost/visible)"
else
  fail "Prepend mount" "not found"
fi

if LC_ALL=C grep -q "location.assign('//'+baseDomain+'/')" "$NAV_HTML"; then
  pass "Nav bar has Dashboard apex redirect"
else
  fail "Dashboard apex redirect" "not found"
fi

if LC_ALL=C grep -q '_ocp_portal' "$NAV_HTML"; then
  pass "Nav bar has OC Portal dropdown button"
else
  fail "OC Portal button" "not found"
fi

if LC_ALL=C grep -q "menu.setAttribute('data-component','dropdown-menu-content')" "$NAV_HTML"; then
  pass "Nav bar uses OpenCode dropdown-menu component"
else
  fail "OpenCode dropdown component" "not found"
fi

if LC_ALL=C grep -q "menu.id='_ocp_dropdown'" "$NAV_HTML"; then
  pass "Nav bar has dropdown menu"
else
  fail "Dropdown menu" "not found"
fi

if LC_ALL=C grep -q "switchItem.id='_ocp_switch'" "$NAV_HTML"; then
  pass "Nav bar has instance switch submenu"
else
  fail "Instance switch submenu" "not found"
fi

if LC_ALL=C grep -q 'Hello E2E' "$NAV_HTML"; then
  pass "Original HTML content preserved after injection"
else
  fail "Original content" "missing"
fi

# ---- 6f. SSE streaming proxy ----
echo ""
echo "6f. SSE streaming proxy"

SSE_RESP=$(curl -sN --max-time 2 -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" "http://localhost:19080/global/event" 2>/dev/null || true)
if echo "$SSE_RESP" | grep -q 'server.connected'; then
  pass "SSE /global/event streams through proxy"
else
  fail "SSE streaming" "got: $SSE_RESP"
fi

# ---- 6g. App Basic Auth compatibility (WhisperCode) ----
echo ""
echo "6g. App Basic Auth compatibility"

APP_BASIC=$(echo -n 'opencode:e2e-secret' | base64 -w0 2>/dev/null || echo -n 'opencode:e2e-secret' | base64)
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Host: e2e-vm.localhost" \
  -H "Authorization: Basic $APP_BASIC" \
  "http://localhost:19080/api/test")
if [ "$CODE" = "200" ]; then
  pass "Basic auth (password=sharedSecret) → 200"
else
  fail "Basic auth (password=sharedSecret)" "got $CODE"
fi

AUTH_TOKEN=$(echo -n 'opencode:e2e-secret' | base64 -w0 2>/dev/null || echo -n 'opencode:e2e-secret' | base64)
AUTH_TOKEN_RESP=$(curl -s -w $'\n%{http_code}' \
  -H "Host: e2e-vm.localhost" \
  "http://localhost:19080/api/test?path=src&auth_token=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AUTH_TOKEN'))")&cursor=0")
CODE=${AUTH_TOKEN_RESP##*$'\n'}
AUTH_TOKEN_BODY=${AUTH_TOKEN_RESP%$'\n'*}
UPSTREAM_URL=$(echo "$AUTH_TOKEN_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
if [ "$CODE" = "200" ] && [ "$UPSTREAM_URL" = "/api/test?path=src&cursor=0" ]; then
  pass "auth_token authenticates inbound and is stripped upstream"
else
  fail "auth_token stripping" "status=$CODE upstream_url=$UPSTREAM_URL"
fi

WRONG_BASIC=$(echo -n 'opencode:wrong-secret' | base64 -w0 2>/dev/null || echo -n 'opencode:wrong-secret' | base64)
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Host: e2e-vm.localhost" \
  -H "Authorization: Basic $WRONG_BASIC" \
  "http://localhost:19080/api/test")
if [ "$CODE" = "401" ]; then
  pass "wrong Basic password → 401"
else
  fail "wrong Basic password → 401" "got $CODE"
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Host: e2e-vm.localhost" \
  -H "Origin: tauri://localhost" \
  "http://localhost:19080/global/config")
if [ "$CODE" != "302" ] && [ "$CODE" != "401" ]; then
  pass "OPTIONS preflight bypasses Portal auth (got $CODE)"
else
  fail "OPTIONS preflight bypass" "got $CODE"
fi

curl -s -X PATCH -H "Authorization: Bearer e2e-secret" \
  -H "Content-Type: application/json" \
  -d '{"opencodeUser":"admin","opencodePassword":"upstream-pass"}' \
  "http://localhost:19080/api/instances/e2e-vm" > /dev/null

EXPECTED_UP=$(echo -n 'admin:upstream-pass' | base64 -w0 2>/dev/null || echo -n 'admin:upstream-pass' | base64)
REWRITE_RESP=$(curl -s \
  -H "Host: e2e-vm.localhost" \
  -H "Authorization: Basic $APP_BASIC" \
  "http://localhost:19080/api/test")
GOT_AUTH=$(echo "$REWRITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('authorization',''))" 2>/dev/null || echo "")
if echo "$GOT_AUTH" | grep -qi "Basic $EXPECTED_UP"; then
  pass "upstream Authorization rewritten to opencodeUser:opencodePassword"
else
  fail "upstream Authorization rewrite" "got: $GOT_AUTH"
fi

# ---- 7. Instance offline detection ----
echo ""
echo "7. Instance offline detection"
kill $AGENT_PID 2>/dev/null || true
sleep 2

RESP=$(curl -s http://localhost:19080/health)
ONLINE=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['online'])" 2>/dev/null || echo 1)
if [ "$ONLINE" = "0" ]; then
  pass "Instance marked offline after agent disconnect"
else
  fail "Instance offline" "online count: $ONLINE"
fi

# ---- 8. Unknown instance 404 ----
echo ""
echo "8. Error responses"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer e2e-secret" -H "Host: unknown.localhost" http://localhost:19080/)
if [ "$CODE" = "404" ]; then
  pass "unknown.localhost → 404"
else
  fail "unknown.localhost → 404" "got $CODE"
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer e2e-secret" -H "Host: e2e-vm.localhost" http://localhost:19080/)
if [ "$CODE" = "503" ]; then
  pass "e2e-vm.localhost (offline) → 503"
else
  fail "e2e-vm.localhost → 503" "got $CODE"
fi

# ---- Report ----
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}"
echo -e "${CYAN}========================================${NC}"

# Cleanup
kill $ECHO_PID $GW_PID 2>/dev/null || true
wait 2>/dev/null || true

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "--- Gateway logs ---"
  cat "$TMPDIR/gw.log" | tail -20
  echo "--- Agent logs ---"
  cat "$TMPDIR/agent.log" | tail -10
  exit 1
fi
exit 0
