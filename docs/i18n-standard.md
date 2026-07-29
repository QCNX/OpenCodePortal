# OpenCode Portal I18n Standard

This document defines how translations are authored, consumed, and maintained in OpenCode Portal. The canonical implementation lives under [`src/server/i18n/`](../src/server/i18n/); all translatable UI strings must flow through the typed translation schema defined there.

## Goals

- Keep all translatable text in a single typed schema — no raw strings in SSR, injected scripts, or client code.
- Enforce compile-time validation: every locale file must satisfy `TranslationSchema`; missing keys are caught by TypeScript.
- Support three locales (`zh-CN`, `zh-TW`, `en`) with unambiguous normalization of legacy and non-standard locale tags.
- Language switch persists via `language` cookie, survives page reloads, and applies consistently across Dashboard, Login, and proxied OpenCode nav injection.
- Zero runtime i18n library dependency — translations are plain TypeScript objects consumed at SSR time or embedded as JSON in inline scripts.

## Architecture

```
src/server/i18n/
├── index.ts        Public barrel: re-exports, TRANSLATIONS map, getTranslations(), getClientNavTranslations()
├── schema.ts       TranslationSchema + four sub-interfaces (Common, Login, Dashboard, Nav)
├── locale.ts       Locale type, normalisation, detection (server-side), LOCALE_META
└── locales/
    ├── en.ts       English translations (satisfies TranslationSchema)
    ├── zh-cn.ts    Simplified Chinese (zh-CN)
    └── zh-tw.ts    Traditional Chinese (zh-TW)
```

### Flow

```
User request → detectPortalLocale(req)
                  ↓
           getTranslations(locale) → TranslationSchema
                  ↓
    ┌─────────────┼─────────────────────────┐
    ↓             ↓                         ↓
dashboard-page  login-page          nav-script (client)
(SSR HTML)      (SSR HTML)          getClientNavTranslations()
                                      → embedded JSON in inline <script>
```

## Supported Locales

| Locale | HTML lang | Self-label | Aliases recognised |
|--------|-----------|------------|--------------------|
| `zh-CN` | `zh-CN` | Simplified Chinese | `zh`, `zh-cn`, `zh-sg`, `zh-hans*` |
| `zh-TW` | `zh-TW` | Traditional Chinese | `zht`, `zh-tw`, `zh-hk`, `zh-hant*` |
| `en` | `en` | English | `en`, `en-*` |

`DEFAULT_LOCALE = 'zh-CN'`. Everything else normalises to the default.

## Normalisation Rules

Defined in `parseLocale()` (`src/server/i18n/locale.ts`):

1. `decodeURIComponent`, trim, lowercase, `_` → `-`.
2. Take only the first `,`- or `;`-separated segment (strips quality weights from `Accept-Language`).
3. Map the resulting tag to one of the three supported locales using the alias table above. Unrecognised tags return `null`.
4. `normalizeLocale()` wraps `parseLocale()` with a fallback to `DEFAULT_LOCALE`.

Server-side detection (`detectPortalLocale`) uses `language` cookie first, then `Accept-Language` header, then default.
Client-side detection (in nav injection script) uses `<html lang>` attribute, then `language` cookie, then `navigator.language`, then `'en'`.

## Translation Schema

All translatable strings are grouped into four namespaces defined in `src/server/i18n/schema.ts`:

| Namespace | Interface | Typical consumers |
|-----------|-----------|-------------------|
| `common` | `CommonTranslations` | Dashboard header, Login, shared inline scripts |
| `login` | `LoginTranslations` | `/login` page |
| `dashboard` | `DashboardTranslations` | Dashboard table, modals, detail panel, deploy instructions |
| `nav` | `NavTranslations` | Proxied OpenCode nav bar injection + client nav translations |

Every locale file uses `satisfies TranslationSchema`:

```typescript
export const zhCN = {
  common: { /* ... */ },
  login: { /* ... */ },
  dashboard: { /* ... */ },
  nav: { /* ... */ },
} satisfies TranslationSchema;
```

This guarantees that missing keys — or keys present in one locale but absent in another — are caught at compile time.

### Adding a new translatable string

1. Add the key to the appropriate sub-interface in `schema.ts`. Document the key's purpose with a comment if the name alone is unclear.
2. Add the translated value to every locale file under `src/server/i18n/locales/`.
3. Consume it via `getTranslations(locale)` on the server side, or add it to `getClientNavTranslations()` if it's needed in the injected nav script.
4. Run `pnpm test` — TypeScript will flag any missing locale entry immediately.

> **Do not add translatable strings directly to page files or proxy script files.** Short UI text belongs in the typed schema packs. Long content (e.g. setup guides) belongs in `docs/setup-guide/<locale>.md`.

## Consumption Patterns

### Server-side SSR (Dashboard, Login)

```typescript
import { getTranslations, getHtmlLang, type PortalLocale } from '../i18n';

const locale = detectPortalLocale(req);
const t = getTranslations(locale);

// Use flat spread for template convenience:
const merged = { ...t.common, ...t.dashboard };
```

Keys are consumed in HTML templates with `escapeHtml()` / `escapeAttr()`:

```typescript
`<h2>${escapeHtml(t.addTitle)}</h2>`
`<input placeholder="${escapeAttr(t.searchPlaceholder)}">`
```

### Client-side (Nav injection script)

The injected `<script>` receives translations as a JSON object embedded via `safeJson()`:

```typescript
import { getClientNavTranslations } from '../i18n';
const translationsJson = safeJson(getClientNavTranslations());
// Result shape: { 'zh-CN': { dash, switch, refresh, logout, offline }, ... }
```

This object is inlined in the script; at runtime the script calls its own `detectLocale()` and indexes into it. Only nav-specific keys are shipped to the client — dashboard and login keys stay server-side.

### Language Switcher

The language dropdown (shared between Dashboard and Login via `renderLanguageSelector`) writes the `language` cookie and triggers `location.reload()`. The cookie has `Domain=.<baseDomain>` scope on production domains so the language choice persists across instance subdomains.

## Server / Client Locale Detection Divergence

| Entry point | Detection function | Fallback |
|-------------|-------------------|----------|
| Dashboard SSR | `detectPortalLocale(req)` | `'zh-CN'` |
| Login SSR | `detectPortalLocale(req)` | `'zh-CN'` |
| Nav injection (client) | inline `detectLocale()` | `'en'` |

The client fallback differs intentionally: the injected script cannot trust `Accept-Language` in the same way, and `'en'` is a safer default when the `<html lang>` attribute, `language` cookie, and `navigator.language` all fail to resolve.

## Red Lines

- **Never hardcode translatable strings in SSR templates or inline scripts.** Every visible UI string must come from `TranslationSchema`.
- **Never add a key to only one locale file.** The `satisfies TranslationSchema` constraint prevents this, but be aware: adding a key to `schema.ts` without updating all locale files will break the build.
- **Never use `innerHTML` to render translated text in client scripts.** Use `textContent` or DOM APIs to avoid XSS. `esc()` / `safeJson()` are already used server-side; client-side nav injection uses `textContent` only.
- **Never change the `SUPPORTED_LOCALES` array without updating all locale files, `LOCALE_META`, and `parseLocale()` alias logic.**
- **Never import locale files directly from page code.** Always use `getTranslations(locale)` via the public barrel (`src/server/i18n/index.ts`). This keeps locale resolution in one place.
- **Never ship full `TranslationSchema` to the client.** The nav injection script receives only `ClientNavTranslations` (5 keys). Dashboard/login translations are server-side only.
- **Never skip `escapeHtml` / `escapeAttr` on translated values in SSR.** Translation packs are trusted content authored by developers, but they may contain characters that break HTML (quotes, `<`, `>`). Always escape at the interpolation site.
- **Never add i18n libraries (i18next, react-intl, etc.).** The system uses plain TypeScript objects + SSR string interpolation. No runtime library.

## Testing

- **Locale normalisation tests:** `src/server/i18n/locale.test.ts` — verifies that `parseLocale` correctly maps all alias variants to the three supported locales.
- **Dashboard SSR tests:** `src/server/webui/dashboard-page.test.ts` — validates that translated strings appear in rendered HTML (e.g. "Agent Version" for `colAgentVersion`, "Active Proxies" for `colSessions` in `en`).
- **Login page tests:** `tests/playwright/gateway.spec.ts` — browser-level validation of language switching and cookie persistence.
- **Nav injection tests:** `src/server/proxy/nav-injection.test.ts` — validates that `getClientNavTranslations()` output is correctly embedded and escaped in injected scripts.
- **Type-level guard:** Every locale file uses `satisfies TranslationSchema` — running `pnpm build` or `pnpm test` catches missing/mismatched keys immediately.
