# ADR 0005: Proxied HTML — Nav Injection & CSP Compatibility

**Date:** 2026-06-14
**Status:** Accepted

> Gateway injects Portal navigation controls (OC Portal button + dropdown menu) into proxied OpenCode HTML pages while ensuring inline scripts execute without breaking OpenCode's strict CSP.

---

## Context

OpenCode is a SPA (Single Page Application) with its own titlebar (`#opencode-titlebar-left`) and dropdown menu components (`data-component="dropdown-menu-content"`). Portal needs to insert a navigation entrypoint at the top of every proxied OpenCode page:

1. **Portal button** — opens Dashboard / Switch Instance / Refresh / Logout
2. **Instance switching** — lists all registered instances in a dropdown submenu
3. **CSP compatibility** — OpenCode serves strict `Content-Security-Policy` (typically containing both `script-src` and `script-src-elem`). Inline scripts are blocked unless their exact sha256 is whitelisted.

Constraints:

1. **Cannot modify OpenCode source** — all modifications happen at the proxy layer.
2. **Must reuse OpenCode theme** — use OpenCode's CSS variables (`--button-secondary-*`, `--surface-raised-*`, etc.), not Portal styles.
3. **DOM stability** — OpenCode is a SPA; the titlebar may re-render on route changes. Injected controls must auto-restore.
4. **XSS prevention** — instance metadata (name, id, tags) comes from Registry, is untrusted, and must not be directly interpolated into HTML or concatenated via innerHTML.
5. **Internationalization** — dropdown menu labels must follow the user's language setting.
6. **Portal button text is never translated** — always displays "OC Portal" (English).

### Rejected designs

- **Full Shadow DOM component**: OpenCode theme variables don't penetrate Shadow DOM; CSS variables cannot be reused.
- **CSS override of OpenCode titlebar**: Titlebar structure is not fixed (legacy and v2 coexist); CSS selectors are hard to generalize.
- **iframe-embedded Dashboard**: cross-origin issues, OIDC cookie Domain mismatch.

---

## Decision

### 1. Injection method

Gateway's `DefaultResponseTransformer.transformHtmlResponse()` processes every proxied HTML response:

```
injectPortalNav(body, model, contentType)
  → check charset: non-UTF-8 → skip (isUtf8Html)
  → find </body>: present → insert before; absent → append
  → compute inline script sha256 hash
  → patchCspInHtml() patch <meta> CSP tags in HTML
  → return { body, scriptHash }
```

The outer `patchCspForScript()` synchronously patches response headers `Content-Security-Policy` and `Content-Security-Policy-Report-Only`:

```
transformHtmlResponse()
  → injectPortalNav() → get scriptHash
  → patchCspForScript(headers, scriptHash)
  → overrideCacheHeaders(headers)
  → update content-length
```

**Why inject a `<script>` instead of adding HTML fragments?** Navigation controls need DOM manipulation (wait for `#opencode-titlebar-left` to render, mount into it, listen to MutationObserver). Pure HTML cannot achieve this.

### 2. CSP hash whitelist

OpenCode's CSP typically contains:

```
Content-Security-Policy: script-src 'sha256-A...' 'sha256-B...'; script-src-elem 'sha256-A...'
```

The injected script would be rejected by the browser unless its sha256 appears in **every** script-class directive.

`patchCspPolicyString(policy, scriptHash)` algorithm:

1. Split policy string by `;`
2. Find all `script-src` and `script-src-elem` directives, append `'sha256-<hash>'`
3. If no script directives exist, fall back to `default-src` (append)
4. Re-join with `;`

`patchCspForScript()` calls the above on all `content-security-policy` and `content-security-policy-report-only` headers. `patchCspInHtml()` does the same for `<meta http-equiv="Content-Security-Policy">` tags.

**Why not use `'unsafe-inline'`?** CSP spec: when a policy already contains hashes/nonces, `'unsafe-inline'` is ignored. OpenCode uses hash whitelists, so we must follow the same route.

### 3. DOM mounting strategy

Injected script content:

```
1. Define helper functions (findVisibleTitlebarRight, closeAll, goDashboard, etc.)
2. scheduleTryMount() → requestAnimationFrame(fn)
   → findVisibleTitlebarRight() iterates all #opencode-titlebar-right nodes
      takes the first one with getBoundingClientRect().width > 0 (visible)
   → createNav() builds #_ocp_nav (contains #_ocp_portal button)
   → host.insertBefore(nav, host.firstChild) — attach as first child of the right-side container
3. MutationObserver(document.documentElement, { childList:true, subtree:true })
   → calls scheduleTryMount() on every DOM change
   → re-mounts (prevents SPA re-render from losing controls)
4. Second MutationObserver watches lang/data-theme/data-color-scheme attribute changes
   → refreshLabels()
```

**Why requestAnimationFrame instead of immediate execution?** OpenCode's React components may update the DOM multiple times within the same microtask. rAF ensures execution before the browser's next paint, avoiding insertion into temporary or about-to-be-replaced DOM nodes.

**Why firstElementChild instead of appendChild?** The Portal button needs to sit at the far left of the right-side titlebar container, before OpenCode's own status/review buttons. `insertBefore(nav, host.firstChild)` guarantees highest priority.

### 4. Dropdown menu positioning

Main menu `#_ocp_dropdown` (`data-component="dropdown-menu-content"`):

- `position: fixed`
- Bottom-right aligned (`right = window.innerWidth - btn.right`, `top = btn.bottom + 4px`)
- Recalculated via `positionDropdown()` on each open

Submenu `#_ocp_submenu` (`data-component="dropdown-menu-sub-content"`):

- `position: fixed` (directly attached to `document.body`)
- Position calculated from `#_ocp_switch` (switch instance trigger) via `getBoundingClientRect()`
- `top = trigger.top`, `left = trigger.right + 4px` (opens to the right)
- **NOT nested inside the main menu** — avoids clipping by `overflow:hidden`

**Why fixed + body instead of nested?** OpenCode's `dropdown-menu-content` component may set `overflow: hidden` (for rounded corner clipping). A nested submenu would be clipped invisible.

### 5. Instance switch submenu interaction

```
Mouse hover #_ocp_switch:
  → cancelHideSub() — cancel submenu close timer
  → showSub() — calculate position and display

Mouse leave #_ocp_switch:
  → scheduleCloseSub() — 80ms delay then close
  → if mouse enters submenu within 80ms (cancelHideSub) → stay open

Mouse enter submenu → cancelHideSub()
Mouse leave submenu → scheduleCloseSub() → 80ms then close
```

The 80ms delay allows the mouse to travel diagonally from trigger to submenu without accidental close.

### 6. Menu label internationalization

The injected script embeds translation packs (`getClientNavTranslations()`):

```typescript
{
  "zh-CN": { /* Simplified Chinese translations */ },
  "zh-TW": { /* Traditional Chinese translations */ },
  "en":     { "dash": "Dashboard", "switch": "Switch Instance", "refresh": "Refresh", "logout": "Logout", "offline": "(offline)" }
}
```

Language detection priority:

1. `document.documentElement.lang`
2. `language` cookie (backward-compatible parsing: `zh`→Simplified Chinese, `zht`→Traditional Chinese)
3. `navigator.language`

`refreshLabels()` recalculates labels in three cases:

1. `lang` attribute change
2. `data-theme` attribute change (some theme switches also change lang)
3. `data-color-scheme` attribute change

Portal button text ("OC Portal") is hardcoded in the script, not subject to i18n translation.

### 7. XSS prevention

| Data | Handling |
|------|----------|
| Instance list JSON | `safeJson()` (JSON.stringify + escape `</` and `\u2028`/`\u2029`) |
| Instance names | Only `textContent` assignment (not innerHTML) |
| Instance IDs | Only used in URL concatenation `//${id}.${baseDomain}/` (baseDomain is config value, trusted) |
| baseDomain | Config file value, trusted |

All DOM creation in the script uses `document.createElement()` + `textContent`. No `innerHTML` or `insertAdjacentHTML`.

### 8. Cache control

All proxied responses are processed through `overrideCacheHeaders()`:

- `Cache-Control: no-cache` — prevents browser from caching modified HTML
- Preserves `ETag` / `Last-Modified` — allows 304 revalidation

### 9. Non-UTF-8 skip

`isUtf8Html()` checks the `charset` parameter in `Content-Type`:
- No charset → default to UTF-8 (vast majority of OpenCode pages)
- Charset explicitly UTF-8 or utf8 → inject
- Other charsets (e.g. `gbk`, `shift_jis`) → skip injection

---

## Consequences

### Positive

1. **Seamless integration** — Portal controls look like native OpenCode components (reuse identical data attributes and CSS variables).
2. **CSP security** — does not lower OpenCode's security policy; precise sha256 hash maintains strictest CSP.
3. **SPA robustness** — MutationObserver + rAF ensures controls auto-recover after SPA route changes or re-renders.
4. **Zero XSS risk** — textContent + safeJson throughout, no innerHTML concatenation of untrusted data.
5. **Internationalization** — menu labels auto-update when the user switches language.

### Negative

1. **Script size** — inline script ~5KB minified, one extra transfer per HTML page. After gzip ~1.5KB, acceptable.
2. **Theme dependency** — component appearance fully depends on OpenCode's CSS variables. If upstream significantly restructures the DOM (e.g. deprecates `data-component="button"`), a fresh audit is required. Originally anchored to upstream commit `anomalyco/opencode@dbbe67f` (2026-06-12). **Updated 2026-07-23**: OpenCode v1.17.19+ introduced a V2 UI (`body[data-new-layout]`) with `button-v2` / `menu-v2-*` components and `--v2-*` CSS variables. The injected script now detects V2 at runtime and uses the matching component contract (see `src/server/proxy/nav-script.ts`).
3. **CSP hash varies with instance list** — adding/removing instances changes the hash, causing the browser to re-download the full page. This is not a problem (first-load behavior by design).
4. **Multiple #opencode-titlebar-right nodes** — both legacy and V2 mount into `#opencode-titlebar-right`; legacy pages can render duplicate titlebar containers, so `findVisibleTitlebarRight()` picks the first node with width>0 while `findV2Mount()` uses a plain `querySelector`. If both duplicates are visible (not yet observed), the mount may land on the wrong one (mitigated by MutationObserver re-mount).

### Detection checklist

`injectNavBar()` recomputes on every injection, covering:

- [x] `<script>` bytes → sha256 → patch response headers `Content-Security-Policy` / `Content-Security-Policy-Report-Only`
- [x] Patch `<meta http-equiv="Content-Security-Policy">`
- [x] Don't overwrite existing `'strict-dynamic'`/`'nonce-...'` in `script-src` (append, not replace)
- [x] Upstream content-length updated
- [x] Cache-Control no-cache

### Implementation files

- `src/server/proxy/nav-injection.ts` — `injectPortalNav()`, `isUtf8Html()`
- `src/server/proxy/nav-script.ts` — `renderPortalNavScript()` script generation
- `src/server/proxy/csp.ts` — `patchCspPolicyString()`, `patchCspForScript()`, `patchCspInHtml()`
- `src/server/proxy/cache-headers.ts` — `overrideCacheHeaders()`
- `src/server/proxy/response-transformer.ts` — `DefaultResponseTransformer.transformHtmlResponse()`
- `src/server/i18n/` — translation resources
- `src/server/webui/escape.ts` — `safeJson()`, `escapeHtml()`

---

## Amendment 2026-08-10 — Legacy mounts to the right-side container

The original decision mounted the Portal button into `#opencode-titlebar-left` on legacy pages (and `#opencode-titlebar-right` on V2 pages). The legacy mount point was unified to `#opencode-titlebar-right` so both layouts present the same button order — **OC Portal first, then OpenCode's native status/review buttons**. `findVisibleTitlebarLeft()` was replaced by `findVisibleTitlebarRight()` (same visible-node selection, applied to the right container); `findV2Mount()` is unchanged. If a legacy page has no `#opencode-titlebar-right` container, injection is skipped — no fallback to the left container. The `#_ocp_nav` margin moved from `margin-right` to `margin-left` accordingly.

## References

- `src/server/proxy/nav-injection.ts`
- `src/server/proxy/nav-script.ts` — full injection script
- `src/server/proxy/csp.ts`
- `src/server/proxy/response-transformer.ts`
- `src/server/i18n/` — client-side translation packs `getClientNavTranslations()`
- `docs/anomalyco/opencode@dbbe67f` — upstream titlebar component structure audit baseline (legacy)
- `anomalyco/opencode` (dev branch, 2026-07-23) — V2 UI audit: `data-new-layout` signal, `button-v2` / `menu-v2-*` contract, `--v2-*` CSS variables
