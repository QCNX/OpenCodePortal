// ---------------------------------------------------------------------------
// Playwright E2E tests for OpenCode Portal
// ---------------------------------------------------------------------------
import { test, expect } from '@playwright/test';
import { setupEnv, TestEnv } from './helper';

let env: TestEnv;

test.beforeAll(async () => {
  env = await setupEnv();
});

test.afterAll(() => {
  env.cleanup();
});

// Helper: log in via the login form on the given origin (apex or instance subdomain).
async function loginViaForm(page: any, baseUrl: string = env.gatewayUrl): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.fill('input[name="secret"]', env.secret);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(`${baseUrl}/`);
}

/** Open an instance path with auth (?token= works when .localhost SSO cookies do not cross subdomains). */
async function gotoInstance(page: any, path: string = '/'): Promise<void> {
  const url = new URL(path, env.instanceUrl);
  url.searchParams.set('token', env.secret);
  await page.goto(url.toString());
}

// ---------------------------------------------------------------------------
// 1. Dashboard rendering
// ---------------------------------------------------------------------------
test('dashboard: renders with instance table and last-seen column', async ({ page }) => {
  await loginViaForm(page);
  await expect(page.locator('h1')).toHaveText('OpenCode Portal');
  await expect(page.locator('.portal-version')).toBeVisible();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#statusFilter')).toBeVisible();
  await expect(page.locator('#refreshStatus')).toBeVisible();
  await expect(page.locator('#refreshStatus')).toHaveAttribute('aria-label', 'Refresh agent status');
  await expect(page.locator('#refreshStatus [data-portal-icon="refresh"]')).toBeVisible();
  await expect(page.locator('#theme-toggle [data-portal-icon="system"]')).toBeVisible();
  await expect(page.locator('#lang-btn [data-portal-icon="language"]')).toBeVisible();
  await expect(page.locator('th[data-col="agentVersion"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Instance' })).toHaveAttribute('data-variant', 'contrast');

  const row = page.locator('tbody tr').first();
  await expect(row.locator('td').nth(1)).toContainText('PW Test VM');
  await expect(row.locator('span.portal-status-dot.online')).toBeVisible();
  await expect(row.locator('.last-seen')).toContainText('now');
  await expect(row.locator('[data-portal-icon="info"]')).toBeVisible();
  await expect(row.locator('[data-portal-icon="deploy"]')).toBeVisible();
  await expect(row.locator('[data-portal-icon="edit"]')).toBeVisible();
  await expect(row.locator('[data-portal-icon="delete"]')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  const credentialHint = page.locator('#addEditOverlay .portal-field-note');
  await expect(credentialHint).toBeVisible();
  await expect(credentialHint).toContainText('must match opencode serve');
  await expect(credentialHint).toContainText('Portal sharedSecret');
  await expect(credentialHint).toContainText('Agent settings do not configure OpenCode authentication');
  await page.locator('#addEditOverlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#addEditOverlay')).not.toHaveClass(/visible/);

  await page.locator('#theme-toggle').click();
  await expect(page.locator('#theme-toggle [data-portal-icon="sun"]')).toBeVisible();

  const currentUrl = page.url();
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#refreshStatus').click(),
  ]);
  await expect(page).toHaveURL(currentUrl);
  await expect(page.locator('#refreshStatus')).toBeVisible();
});

test('dashboard: deploy modal provides Docker and Compose upgrade guides', async ({ page }) => {
  await loginViaForm(page);
  await page.getByRole('button', { name: 'Deploy' }).first().click();

  const deployCredentialHint = page.locator('#deployOverlay .portal-field-note');
  await expect(deployCredentialHint).toContainText('configure only the Agent tunnel');
  await expect(deployCredentialHint).toContainText('Dashboard instance');
  await expect(deployCredentialHint).toContainText('host opencode serve configuration');

  const tabs = page.locator('.deploy-method-tabs .portal-tab');
  await expect(tabs).toHaveCount(2);
  const dockerWidth = await tabs.nth(0).evaluate((el) => el.getBoundingClientRect().width);
  const composeWidth = await tabs.nth(1).evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(dockerWidth - composeWidth)).toBeLessThan(1);

  await expect(page.locator('#deployTabDocker')).toContainText('Upgrade Guide');
  await expect(page.locator('#deployTabDocker')).toContainText('docker pull');
  await expect(page.locator('#deployTabDocker')).toContainText('docker rm -f');

  await page.getByRole('button', { name: 'Compose & .env' }).click();
  await expect(page.locator('#deployTabCompose')).toBeVisible();
  await expect(page.locator('#deployTabCompose')).toContainText('Upgrade Guide');
  await expect(page.locator('#deployTabCompose')).toContainText('docker compose pull');
  await expect(page.locator('#deployTabCompose')).toContainText('docker compose up -d --force-recreate');
});

test('dashboard: modal Close/Cancel buttons dismiss overlays', async ({ page }) => {
  // Regression: closeModal mousedown guard used to block button closes (e === undefined/null).
  await loginViaForm(page);

  await page.getByRole('button', { name: 'Deploy' }).first().click();
  await expect(page.locator('#deployOverlay')).toHaveClass(/visible/);
  await page.locator('#deployOverlay').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#deployOverlay')).not.toHaveClass(/visible/);

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.locator('#addEditOverlay')).toHaveClass(/visible/);
  await page.locator('#addEditOverlay').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#addEditOverlay')).not.toHaveClass(/visible/);

  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.locator('#deleteOverlay')).toHaveClass(/visible/);
  await page.locator('#deleteOverlay').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#deleteOverlay')).not.toHaveClass(/visible/);

  await page.locator('tbody tr').first().locator('.portal-detail-action').click();
  await expect(page.locator('#modalOverlay')).toHaveClass(/visible/);
  await page.locator('#modalOverlay').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#modalOverlay')).not.toHaveClass(/visible/);
});

// ---------------------------------------------------------------------------
// 2. Login page
// ---------------------------------------------------------------------------
test('login: renders form', async ({ page }) => {
  await page.goto(`${env.gatewayUrl}/login`);
  await expect(page.locator('h1')).toContainText('OpenCode Portal');
  await expect(page.locator('form[method="POST"]')).toBeVisible();
  await expect(page.locator('input[name="secret"]')).toBeVisible();
  await expect(page.locator('.portal-version--footer')).toBeVisible();
});

test('login: wrong secret shows error', async ({ page }) => {
  await page.goto(`${env.gatewayUrl}/login`);
  // Set language cookie so locale detection picks Chinese
  await page.evaluate(() => { document.cookie = 'language=zh; path=/'; });
  await page.reload();
  await page.fill('input[name="secret"]', 'wrong-secret');
  await page.click('button[type="submit"]');
  await expect(page.locator('.portal-error')).toBeVisible();
  await expect(page.locator('.portal-error')).toContainText('密钥错误');
});

test('login: language switcher persists English and Traditional Chinese', async ({ page }) => {
  await page.goto(`${env.gatewayUrl}/login`);
  await page.click('#lang-btn');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible();

  await page.click('#lang-btn');
  await page.getByRole('button', { name: '繁體中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.getByText('登入以繼續', { exact: true })).toBeVisible();
});

test('login: correct secret redirects and sets cookie', async ({ page }) => {
  await page.goto(`${env.gatewayUrl}/login`);
  await page.fill('input[name="secret"]', env.secret);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(`${env.gatewayUrl}/`);
  const cookies = await page.context().cookies();
  const authCookie = cookies.find((c: any) => c.name === 'ocp_auth');
  expect(authCookie).toBeDefined();
  expect(authCookie!.httpOnly).toBe(true);
  // Browsers may normalize Domain=.localhost to "localhost" on localhost origins
  expect(['localhost', '.localhost']).toContain(authCookie!.domain);
});

// ---------------------------------------------------------------------------
// 3. Subdomain routing
// ---------------------------------------------------------------------------
test('subdomain-routing: instance subdomain serves proxied root', async ({ page }) => {
  await gotoInstance(page, '/');

  await expect(page).toHaveURL(new RegExp(`^${env.instanceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?token=`));
  const body = await page.textContent('body');
  expect(body).toContain('"ok":true');
});

test('subdomain-routing: instance subdomain proxies API paths', async ({ page }) => {
  await gotoInstance(page, '/api/test');
  const body = await page.textContent('body');
  expect(body).toContain('"ok":true');
  expect(body).toContain('"path":"/api/test');
});

test('subdomain-routing: apex login then instance access via token', async ({ page }) => {
  await loginViaForm(page);
  await gotoInstance(page, '/api/test');
  const body = await page.textContent('body');
  expect(body).toContain('"ok":true');
});

// ---------------------------------------------------------------------------
// 4. WS terminal echo
// ---------------------------------------------------------------------------
test('ws-terminal: browser WebSocket echo via evaluate', async ({ page }) => {
  await gotoInstance(page, '/');

  const result = await page.evaluate(({ instanceUrl, secret }) => {
    const wsUrl = instanceUrl.replace('http', 'ws') + '/echo?token=' + encodeURIComponent(secret);
    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 4000);

      ws.addEventListener('open', () => { ws.send('hello'); });
      ws.addEventListener('message', (evt) => {
        clearTimeout(timeout);
        ws.close();
        resolve(typeof evt.data === 'string' ? evt.data : 'binary');
      });
      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('ws-error'));
      });
    });
  }, { instanceUrl: env.instanceUrl, secret: env.secret }).catch((e: Error) => e.message || 'failed');

  expect(result).toContain('echo:hello');
});

// ---------------------------------------------------------------------------
// 5. Nav bar injection
// ---------------------------------------------------------------------------
test('nav-bar: injected into proxied HTML page', async ({ page }) => {
  await gotoInstance(page, '/html');

  const titlebar = page.locator('#opencode-titlebar-left');
  await expect(titlebar).toBeVisible();
  const nav = titlebar.locator('#_ocp_nav');
  await expect(nav).toBeVisible();

  const isFirstChild = await page.evaluate(() => {
    const navEl = document.getElementById('_ocp_nav');
    const tb = document.getElementById('opencode-titlebar-left');
    return !!(navEl && tb && tb.firstElementChild === navEl);
  });
  expect(isFirstChild).toBe(true);

  const portalBtn = nav.locator('#_ocp_portal');
  await expect(portalBtn).toContainText(/OC (Portal|门户)/);
  await expect(portalBtn).toHaveAttribute('data-component', 'button');
  await expect(portalBtn).toHaveAttribute('data-variant', 'secondary');
  const html = await page.content();
  expect(html).toContain("location.assign('//'+baseDomain+'/')");
  expect(html).not.toContain('href="/dashboard"');
  expect(html).toContain('_ocp_dropdown');
  expect(html).toContain('_ocp_switch');

  await expect(page.locator('h1')).toContainText('Hello E2E');
});

test('nav-bar: not injected into non-HTML responses', async ({ page }) => {
  await gotoInstance(page, '/api/test');

  const body = await page.textContent('body');
  expect(body).toContain('"ok":true');
  expect(body).not.toContain('_ocp_nav');
});
