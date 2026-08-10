import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { injectPortalNav } from './nav-injection';
import { InstanceRegistry } from '../registry';
import { MemoryStateStore } from '../../shared/state';
import { BASE_DOMAIN } from '../test-helpers';

const instances = [
  { id: 'vm-one', name: 'VM One', tags: ['dev'] },
  { id: 'vm-two', name: 'VM Two', tags: ['prod'] },
];

function makeNavModel(instanceId: string, registry: InstanceRegistry, authEnabled = false) {
  return {
    baseDomain: BASE_DOMAIN,
    instanceId,
    authEnabled,
    instances: registry.list().map(i => ({
      id: i.id,
      name: i.name,
      status: i.status,
    })),
  };
}

function makeNavRegistry() {
  const registry = new InstanceRegistry();
  const store = new MemoryStateStore();
  registry.hydrate(store);
  for (const inst of instances) {
    registry.create(inst.id, inst.name, inst.tags);
  }
  return registry;
}

describe('injectNavBar', () => {
  it('injects nav bar before </body> in HTML response', () => {
    const registry = makeNavRegistry();
    const body = Buffer.from('<html><head></head><body><p>content</p></body></html>');
    const result = injectPortalNav(body, makeNavModel('vm-one', registry)).body;

    const str = result.toString('utf8');
    expect(str).toContain('<p>content</p>');
    expect(str).toContain("nav.id='_ocp_nav'");
    expect(str).toContain("portalBtn.id='_ocp_portal'");
    expect(str).toContain('OC Portal');
    expect(str).not.toContain('OCP-Dashboard');
    expect(str).not.toContain('← Dashboard');
    expect(str).toContain("location.assign('//'+baseDomain+'/')");
    expect(str).not.toContain('href="/dashboard"');
    expect(str).not.toContain('bottom:0');
    expect(str).toContain('opencode-titlebar-right');
    expect(str).toContain('findVisibleTitlebarRight');
    expect(str).toContain('host.insertBefore(nav,host.firstChild)');
    expect(str).toContain('host.firstElementChild!==nav');
    expect(str).toContain('_ocp_dropdown');
    expect(str).toContain('_ocp_switch');
    expect(str).toContain('detectLocale');
    expect(str).toContain("data-component','dropdown-menu-content'");
    expect(str).toContain("data-component','dropdown-menu-sub-content'");
    expect(str).toContain("data-component','button'");
    expect(str).toContain('PACKS');
    expect(str).toContain("document.body.appendChild(submenuEl)");
    expect(str).toContain('showSub');
    expect(str).toContain('r.right+4');
    expect(str).toContain('width:100%;box-sizing:border-box');
    expect(str).toContain("dropdownEl.style.display='flex'");
    expect(str).toContain('scheduleCloseSub');
    expect(str).toContain('MutationObserver');
    expect(str).toContain('requestAnimationFrame');
    expect(str).not.toContain('obs.disconnect');
    expect(str).not.toContain('findVisibleTitlebarLeft');
    expect(str).not.toContain('host.lastElementChild!==nav');
    expect(str).toContain('location.reload()');
    expect(str).toContain("location.href='//'+inst.id+'.'+baseDomain+'/'");
    expect(str).toContain('var instances=');
    expect(str).not.toContain('ocp_instance');
    expect(str).toContain('</body></html>');
    const navIdx = str.indexOf("nav.id='_ocp_nav'");
    const bodyCloseIdx = str.indexOf('</body>');
    expect(navIdx).toBeLessThan(bodyCloseIdx);
  });

  it('appends nav bar at end when no </body> tag', () => {
    const registry = makeNavRegistry();
    const body = Buffer.from('<html><head></head><div>no body tag</div></html>');
    const result = injectPortalNav(body, makeNavModel('vm-two', registry)).body;

    const str = result.toString('utf8');
    expect(str).toContain('no body tag');
    expect(str).toContain("nav.id='_ocp_nav'");
    expect(str.endsWith('</script>\n')).toBe(true);
  });

  it('does not break on empty body', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from(''), makeNavModel('vm-one', registry)).body;
    expect(result.toString('utf8')).toContain("nav.id='_ocp_nav'");
  });

  it('includes current instance id for submenu highlight', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-two', registry)).body;

    const str = result.toString('utf8');
    expect(str).toContain('var currentSub="vm-two";');
    expect(str).toContain('inst.id===currentSub');
    expect(str).toContain('VM One');
    expect(str).toContain('VM Two');
    expect(str).toContain('"id":"vm-one"');
    expect(str).toContain('"id":"vm-two"');
  });

  it('portal button text is always English regardless of locale', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(
      Buffer.from('<html lang="zh"><body></body></html>'),
      makeNavModel('vm-one', registry),
    ).body;

    const str = result.toString('utf8');
    expect(str).toContain("document.createTextNode('OC Portal')");
    expect(str).toContain('仪表板');
    expect(str).toContain('切换实例');
    expect(str).toContain('(离线)');
    expect(str).toContain('儀表板');
    expect(str).toContain('切換實例');
    expect(str).toContain('(離線)');
    expect(str).toContain('var LOCALE_RULES=');
    expect(str).toContain('"locale":"zh-TW"');
    expect(str).toContain('"locale":"zh-CN"');
    expect(str).toContain('"zh-sg"');
    expect(str).toContain('"zh-hant"');
    expect(str).toContain('"zh-hans"');
  });

  it('keeps the audited OpenCode host component contract', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;

    const str = result.toString('utf8');
    // Legacy path still uses audited legacy contract
    expect(str).toContain("portalBtn.setAttribute('data-component','button')");
    expect(str).toContain("portalBtn.setAttribute('data-variant','secondary')");
    expect(str).toContain("menu.setAttribute('data-component','dropdown-menu-content')");
    expect(str).toContain("sub.setAttribute('data-component','dropdown-menu-sub-content')");
  });

  it('marks offline instances with offline label and disabled rows', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;

    const str = result.toString('utf8');
    expect(str).toContain('(离线)');
    expect(str).toContain("inst.status==='offline'");
    expect(str).toContain('row.disabled=true');
  });

  it('empty currentSub when instanceId does not exist', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('nonexistent', registry)).body;

    const str = result.toString('utf8');
    expect(str).toContain("nav.id='_ocp_nav'");
    expect(str).toContain('var currentSub="";');
  });

  it('content type check responsibility is on caller', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('{"status":"ok"}'), makeNavModel('vm-one', registry)).body;
    expect(result.toString('utf8')).toContain("nav.id='_ocp_nav'");
  });

  it('patches meta CSP in proxied HTML so injected script can run', () => {
    const registry = makeNavRegistry();
    const body = Buffer.from(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'wasm-unsafe-eval\'"></head><body></body></html>',
    );
    const { body: out, scriptHash } = injectPortalNav(body, makeNavModel('vm-one', registry));
    const str = out.toString('utf8');
    expect(str).toContain(`'sha256-${scriptHash}'`);
    expect(str).toContain("nav.id='_ocp_nav'");
  });

  it('returns a sha256 hash matching the injected inline script content', () => {
    const registry = makeNavRegistry();
    const { body: out, scriptHash } = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry));

    const str = out.toString('utf8');
    const m = str.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const scriptContent = m![1];
    const expected = createHash('sha256').update(scriptContent, 'utf8').digest('base64');
    expect(scriptHash).toBe(expected);
  });

  it('escapes instance metadata in injected instances JSON and script literals', () => {
    const registry = new InstanceRegistry();
    const store = new MemoryStateStore();
    registry.hydrate(store);
    registry.create(
      'vm-bad',
      `Evil </option><script>alert('x')</script>`,
      [],
    );

    const { body: out } = injectPortalNav(
      Buffer.from('<html><body></body></html>'),
      makeNavModel('vm-bad', registry),
    );
    const str = out.toString('utf8');

    expect(str).not.toContain('</option><script>');
    expect(str).not.toContain("var currentSub='vm-'bad'");
    expect(str).toContain('Evil \\u003c/option\\u003e\\u003cscript\\u003e');
    expect(str).toContain('var currentSub="vm-bad";');
  });

  it('skips injection for non-UTF-8 HTML charset', () => {
    const registry = makeNavRegistry();
    const body = Buffer.from('<html><body><p>content</p></body></html>');
    const result = injectPortalNav(body, makeNavModel('vm-one', registry), 'text/html; charset=gbk');

    expect(result.scriptHash).toBe('');
    expect(result.body).toBe(body);
    expect(result.body.toString('utf8')).not.toContain('_ocp_portal');
  });

  // ── V2 nav injection ──

  it('v2: detects data-new-layout on body at runtime', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    expect(str).toContain("document.body.hasAttribute('data-new-layout')");
    expect(str).toContain('function isV2');
  });

  it('v2: finds mount point in opencode-titlebar-right when V2', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    expect(str).toContain("querySelector('#opencode-titlebar-right')");
  });

  it('v2: tryMount uses V2 mount point when isV2 is true', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    expect(str).toContain('function isV2');
    expect(str).toContain('opencode-titlebar-right');
  });

  it('v2: portal button uses button-v2 with ghost-muted variant and large size', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    expect(str).toContain("setAttribute('data-component','button-v2')");
    expect(str).toContain("setAttribute('data-variant','ghost-muted')");
    expect(str).toContain("setAttribute('data-size','large')");
    // Legacy path still exists
    expect(str).toContain("setAttribute('data-component','button')");
    expect(str).toContain("setAttribute('data-variant','secondary')");
    expect(str).toContain("setAttribute('data-size','small')");
  });

  it('v2: dropdown uses menu-v2-content and menu-v2-item attributes', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    // V2 menu container
    expect(str).toContain("setAttribute('data-component','menu-v2-content')");
    // V2 menu items
    expect(str).toContain("setAttribute('data-component','menu-v2-item')");
    // V2 separator
    expect(str).toContain("setAttribute('data-slot','menu-v2-separator')");
    // Legacy paths still exist
    expect(str).toContain("setAttribute('data-component','dropdown-menu-content')");
    expect(str).toContain("setAttribute('data-slot','dropdown-menu-item')");
  });

  it('v2: switch instance submenu item uses menu-v2-item-chevron SVG arrow', () => {
    const registry = makeNavRegistry();
    const result = injectPortalNav(Buffer.from('<html><body></body></html>'), makeNavModel('vm-one', registry)).body;
    const str = result.toString('utf8');
    expect(str).toContain("data-slot','menu-v2-item-chevron'");
    expect(str).toContain("data-slot','menu-v2-item-content'");
  });
});
