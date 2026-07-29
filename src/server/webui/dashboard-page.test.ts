import { describe, it, expect } from 'vitest';
import { formatPortalVersionLabel, getPortalVersion } from '../../shared/version';
import { renderDashboardPage } from './dashboard-page';
import { Router } from '../router';
import { InstanceRegistry } from '../registry';
import {
  APEX_HOST,
  BASE_DOMAIN,
  createHydratedRegistry,
  createMockReq,
  createMockRes,
} from '../test-helpers';

describe('dashboard (/)', () => {
  it('returns 200 with HTML for /', () => {
    const registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    const router = new Router(registry, undefined, BASE_DOMAIN);
    const req = createMockReq('/', 'GET', APEX_HOST);
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('OpenCode Portal');
    expect(res.body).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(res.body).toContain('Online VM');
    expect(res.body).toContain('Offline VM');
    expect(res.body).toContain('Agent 版本');
    expect(res.body).toContain('id="refreshStatus"');
    expect(res.body).toContain('id="sseStatus"');
    expect(res.body).toContain('setSseStatus');
    expect(res.body).toContain('es.onerror');
    expect(res.body).toContain('aria-label="刷新 Agent 状态"');
    expect(res.body).toContain('data-portal-icon="refresh"');
    expect(res.body).toContain('data-portal-icon="system"');
    expect(res.body).toContain('data-portal-icon="language"');
    expect(res.body).toContain('data-portal-icon="info"');
    expect(res.body).toContain('data-portal-icon="deploy"');
    expect(res.body).toContain('data-portal-icon="edit"');
    expect(res.body).toContain('data-portal-icon="delete"');
    expect(res.body).toContain('class="portal-tabs deploy-method-tabs"');
    expect(res.body).toContain('升级指南');
    expect(res.body).toContain('dockerSteps');
    expect(res.body).toContain('composeSteps');
    expect(res.body).toContain('data.dockerUpgrade');
    expect(res.body).toContain('data.composeUpgrade');
    expect(res.body).toContain('这些命令只配置 Agent 隧道');
    expect(res.body).toContain('上游 OpenCode 凭据保存在 Dashboard 实例中');
    expect(res.body).toContain('必须与 opencode serve 的配置一致');
    expect(res.body).toContain('App 客户端使用 Portal sharedSecret');
    expect(res.body).toContain('Agent 配置不会设置 OpenCode 鉴权');
    expect(res.body.indexOf('id="refreshStatus"')).toBeGreaterThan(res.body.indexOf('id="statusFilter"'));
    expect(res.body).toContain('colspan="9"');
    expect(res.body).toContain(formatPortalVersionLabel(getPortalVersion()));
    expect(res.body.indexOf('portal-version')).toBeLessThan(res.body.indexOf('id="theme-toggle"'));
    expect(res.body).not.toContain('>ⓘ<');
    const variants = [...res.body.matchAll(/data-component="button-v2"[^>]*data-variant="([^"]+)"/g)]
      .map((match) => match[1]);
    const buttonTags = res.body.match(/<button\b[^>]*>/g) ?? [];
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((variant) => ['neutral', 'contrast', 'ghost', 'ghost-muted'].includes(variant))).toBe(true);
    expect(buttonTags.length).toBeGreaterThan(0);
    expect(buttonTags.every((tag: string) => /\btype="(?:button|submit)"/.test(tag))).toBe(true);
    expect(res.body).toContain('data-variant="contrast" data-tone="critical"');
    expect(res.body).not.toContain('portal-btn-secondary');
    expect(res.body).not.toContain('portal-btn-danger');
    expect(res.body).not.toContain('portal-btn-row');
  });

  it('returns 200 with HTML for /dashboard', () => {
    const registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
    ]);
    const router = new Router(registry, undefined, BASE_DOMAIN);
    const req = createMockReq('/dashboard', 'GET', APEX_HOST);
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('OpenCode Portal');
  });

  it('lists instances with correct status', () => {
    const registry = createHydratedRegistry([
      { id: 'vm-online', name: 'Online VM', tags: ['prod'] },
      { id: 'vm-offline', name: 'Offline VM', tags: ['dev'] },
    ]);
    const router = new Router(registry, undefined, BASE_DOMAIN);
    const req = createMockReq('/', 'GET', APEX_HOST);
    const res = createMockRes();

    router.handleRequest(req, res as any);

    expect(res.body).toContain('offline');
    expect(res.body).toContain('实例名称');
  });

  it('renders "No instances configured" when registry is empty', () => {
    const emptyRegistry = new InstanceRegistry();
    const emptyRouter = new Router(emptyRegistry, undefined, BASE_DOMAIN);

    const req = createMockReq('/', 'GET', APEX_HOST);
    const res = createMockRes();

    emptyRouter.handleRequest(req, res as any);

    expect(res.body).toContain('暂无实例');
  });

  it('renders agent version for online instances', () => {
    const html = renderDashboardPage({
      locale: 'zh-CN',
      instances: [{
        id: 'vm-online',
        name: 'Online VM',
        tags: ['prod'],
        status: 'online',
        sessionCount: 2,
        lastSeen: Date.now(),
        connectedAt: Date.now(),
        agentVersion: '0.2.1',
        targetHost: '127.0.0.1',
        targetPort: 4096,
        opencodeUser: '',
        hasOpencodePassword: false,
      }],
      baseDomain: 'localhost',
      authEnabled: false,
      setupGuide: null,
    });

    expect(html).toContain('活跃代理');
    expect(html).toContain('经 Portal 转发的进行中 HTTP/SSE 连接');
    expect(html).toContain('Agent 版本');
    expect(html).toContain('v0.2.1');
    expect(html.indexOf('data-col="agentVersion"')).toBeGreaterThan(
      html.indexOf('data-col="sessionCount"'),
    );
  });

  it('escapes instance metadata in initial dashboard HTML and JSON state', () => {
    const xssRegistry = createHydratedRegistry([
      {
        id: 'vm-bad',
        name: `Bad <img src=x onerror=alert(1)> </script><script>alert(2)</script>`,
        tags: [`prod' onclick='alert(3)`],
      },
    ]);
    const xssRouter = new Router(xssRegistry, undefined, BASE_DOMAIN);
    const req = createMockReq('/', 'GET', APEX_HOST);
    const res = createMockRes();

    xssRouter.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<img src=x onerror=alert(1)>');
    expect(res.body).not.toContain('</script><script>alert(2)</script>');
    expect(res.body).toContain('prod&#39; onclick=&#39;alert(3)');
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(res.body).toContain('\\u003c/script\\u003e');
  });

  it('renders the complete Traditional Chinese locale', () => {
    const html = renderDashboardPage({
      locale: 'zh-TW',
      instances: [],
      baseDomain: 'portal.example.com',
      authEnabled: true,
      setupGuide: null,
    });

    expect(html).toContain('<html lang="zh-TW">');
    expect(html).toContain('新增執行個體');
    expect(html).toContain('尚無執行個體');
    expect(html).toContain('繁體中文');
    expect(html).toContain('aria-label="重新整理 Agent 狀態"');
    expect(html).toContain('必須與 opencode serve 的設定一致');
    expect(html).not.toContain('>undefined<');
  });

  it('closeModal applies mousedown guard only for backdrop clicks with an event', () => {
    // Regression: button onclick="closeXxx()" passes undefined/null for e.
    // Guard must require e so Close/Cancel still dismiss the modal after mousedown on the button.
    const emptySteps = [{ title: 'Step', subSteps: [], content: '<p>hi</p>' }];
    const html = renderDashboardPage({
      locale: 'en',
      instances: [],
      baseDomain: 'localhost',
      authEnabled: false,
      setupGuide: { 'zh-CN': emptySteps, 'zh-TW': emptySteps, en: emptySteps },
    });

    expect(html).toContain('if (e && _ocpMouseDownTarget)');
    expect(html).not.toMatch(/if \(_ocpMouseDownTarget\) \{/);

    // Buttons close without an event; overlays pass the click event for backdrop + drag-select guard.
    expect(html).toContain('onclick="closeDetail()"');
    expect(html).toContain('onclick="closeForm()"');
    expect(html).toContain('onclick="closeDeploy()"');
    expect(html).toContain('onclick="closeDelete()"');
    expect(html).toContain("onclick=\"closeModal(null,'setupOverlay')\"");
    expect(html).toContain('onclick="closeDetail(event)"');
    expect(html).toContain('onclick="closeForm(event)"');
    expect(html).toContain('onclick="closeDeploy(event)"');
    expect(html).toContain('onclick="closeDelete(event)"');
    expect(html).toContain("onclick=\"closeModal(event,'setupOverlay')\"");
  });
});
