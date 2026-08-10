# OpenCode Portal UI Design Standard

This document defines the component, state, layout, accessibility, and host-integration rules for OpenCode Portal. Icon geometry is specified separately in [`icon-design-standard.md`](./icon-design-standard.md).

## Design Boundaries

Portal renders UI in two different documents. They must not share component assumptions.

| Surface | CSS owner | Component contract |
|---|---|---|
| Dashboard and login pages | Portal `/portal.css` | Portal's OpenCode-aligned v2 subset |
| Controls injected into proxied OpenCode | The running OpenCode application | OpenCode host attributes already loaded by that application |

Portal-owned pages may evolve their CSS and markup together. Injected controls cannot assume that `/portal.css`, Portal classes, or every OpenCode v2 stylesheet is present.

## Verified OpenCode Host Contract

The injection boundary was originally checked against the official `anomalyco/opencode` repository at commit `dbbe67f` (2026-06-12), which used legacy `data-component="button"` and `data-component="dropdown-menu-content"`.

**Updated 2026-07-23**: OpenCode v1.17.19+ introduced a V2 UI (`body[data-new-layout]`) with a new component contract:

| Element | Legacy | V2 |
|---------|--------|-----|
| Mount point | `#opencode-titlebar-right`（与 V2 同一容器，位于原生按钮左侧） | `#opencode-titlebar-right` |
| Button | `data-component="button"` / `secondary` / `small` | `data-component="button-v2"` / `ghost-muted` / `large` |
| Dropdown | `data-component="dropdown-menu-content"` | `data-component="menu-v2-content"` |
| Menu items | `data-slot="dropdown-menu-item"` | `data-component="menu-v2-item"` |
| Separator | `data-slot="dropdown-menu-separator"` | `data-slot="menu-v2-separator"` |
| Submenu | `data-component="dropdown-menu-sub-content"` | `data-component="menu-v2-content"` |
| Submenu arrow | CSS caret (inline) | SVG `data-slot="menu-v2-item-chevron"` (16×16) |
| CSS variables | `--button-secondary-*`, `--surface-raised-*` | `--v2-background-*`, `--v2-text-*`, `--v2-icon-*` |

The injected script detects V2 at runtime (`document.body.hasAttribute('data-new-layout')`) and uses the matching component contract. Both paths must remain — legacy for older OpenCode builds, V2 for v1.17.19+. Do not add Portal CSS classes to injected controls; they must rely solely on the host page's loaded stylesheets.

Upstream references:

**Legacy** (audited commit `dbbe67f`):
- <https://github.com/anomalyco/opencode/blob/dbbe67f066fef47761c637624a34b2350cb109c0/packages/app/src/components/titlebar.tsx>
- <https://github.com/anomalyco/opencode/blob/dbbe67f066fef47761c637624a34b2350cb109c0/packages/ui/src/components/button.tsx>
- <https://github.com/anomalyco/opencode/blob/dbbe67f066fef47761c637624a34b2350cb109c0/packages/ui/src/components/dropdown-menu.tsx>

**V2** (dev branch, 2026-07-23):
- <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/components/titlebar.tsx>
- <https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/v2/components/button-v2.tsx>
- <https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/v2/components/menu-v2.tsx>
- <https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/v2/components/icon-button-v2.tsx>

## Portal Button Contract

Text buttons on Portal-owned pages use:

```html
<button type="button" data-component="button-v2" data-variant="neutral" data-size="small">
  Label
</button>
```

Only the upstream v2 variants are allowed:

| Variant | Use |
|---|---|
| `contrast` | Primary action; normally one per surface |
| `neutral` | Secondary action |
| `ghost` | Cancel, dismiss, or low-emphasis action |
| `ghost-muted` | Muted utility action |

`primary`, `secondary`, and `danger` are not valid Portal v2 variants. Critical intent is a Portal semantic extension applied to a valid variant:

```html
<button data-component="button-v2" data-variant="contrast" data-tone="critical">
  Delete
</button>
```

Use `contrast + critical` for irreversible confirmation and `ghost + critical` for a reversible destructive option.

## Specialized Controls

Not every clickable element is a text button.

- Icon-only controls use the classes and sizing rules in the icon standard.
- Tabs use `.portal-tabs` with `.portal-tab`; the active state is `.active`.
- Tag filters use `.portal-chip`; selected state is `.active`.
- Language menu options remain native buttons inside `.portal-lang-dropdown`.
- Copy controls remain `.deploy-code-copy` because their position belongs to the code block component.

Do not attach `button-v2` merely to obtain generic button styling when the control has another established component role.

## Sizing And Layout

- `small` (`24px`) is the default for modal actions and compact field actions.
- `normal` (`28px`) is the default for page toolbars.
- `large` (`32px`) is reserved for full-width login actions or similarly prominent surfaces.
- Use `.portal-button-row` for right-aligned modal actions.
- A full-width two-option tab list uses `.deploy-method-tabs`; each tab owns half the available width.
- Keep spacing in component CSS. Inline style is allowed only for instance-specific layout that has no reusable meaning.

## Interaction And Accessibility

- Every non-submit button must declare `type="button"`.
- Icon-only controls require localized matching `title` and `aria-label` values.
- Focus must remain visible through `:focus-visible` styling.
- Disabled controls use the native `disabled` attribute; `aria-disabled` alone is insufficient for native buttons.
- Color must not be the only state indicator. Tabs use an underline, selected chips change border/surface, and destructive confirmations retain explicit text.
- Buttons created in browser scripts follow the same markup contract as server-rendered controls.

## Review Checklist

- [ ] The control belongs to the correct document boundary.
- [ ] Portal text buttons use only valid v2 variants.
- [ ] Critical intent uses `data-tone="critical"`, not a made-up variant.
- [ ] Specialized controls use their established component class.
- [ ] Non-submit buttons declare `type="button"`.
- [ ] Keyboard focus and disabled behavior are preserved.
- [ ] Dynamic and SSR markup use the same component contract.
- [ ] Injected OpenCode controls still match the latest audited upstream host contract (both Legacy and V2 paths).
- [ ] Tests cover component attributes for any contract change.
