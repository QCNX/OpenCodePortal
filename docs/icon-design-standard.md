# OpenCode Portal Icon Design Standard

This document defines the visual, implementation, interaction, and accessibility rules for icons in OpenCode Portal. General component rules and the OpenCode injection boundary are defined in [`ui-design-standard.md`](./ui-design-standard.md). The canonical icon implementation is [`src/server/webui/icons.ts`](../src/server/webui/icons.ts); shared sizing and button states are defined in [`src/server/webui/assets/portal-css.ts`](../src/server/webui/assets/portal-css.ts).

## Goals

- Match OpenCode's compact, low-contrast interface.
- Render consistently across operating systems and browsers.
- Inherit light and dark theme colors without icon-specific overrides.
- Keep server-rendered HTML and client-rendered rows visually identical.
- Preserve keyboard and screen-reader accessibility.

## Required SVG Geometry

Every Portal icon must use these base attributes:

```html
<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <!-- paths -->
</svg>
```

Mandatory rules:

- Use a `24 x 24` coordinate system.
- Use outline geometry by default; do not mix filled and outlined icons in the same control group.
- Use `1.6` stroke width, with round caps and joins.
- Keep the visible drawing primarily inside the `3..21` coordinate range.
- Center the perceived visual mass, not only the mathematical bounding box.
- Use `currentColor`; do not hard-code normal-state stroke colors.
- Avoid excessive detail that becomes unclear at `14-17px` rendered size.

## Standard Sizes

| Context | Button box | SVG size | CSS class |
|---|---:|---:|---|
| Header theme/language control | `28px` | `16px` | `.portal-theme-toggle`, `.portal-lang-btn` |
| Dashboard refresh | `28px` | `17px` | `.portal-status-refresh` |
| Table row action | `26px` | `16px` | `.portal-row-action` |
| Inline instance details | `20px` | `14px` | `.portal-detail-action` |

Do not enlarge an SVG by changing its `viewBox`. Override rendered `width` and `height` through the owning CSS class.

## Color And States

Icons inherit their color from the button:

| State | Token |
|---|---|
| Header icon default | `--icon-base` |
| Table/inline icon default | `--text-weaker` |
| Refresh default | `--text-weak` |
| Normal hover | `--text-stronger` |
| Destructive hover | `--v2-state-fg-critical`, fallback `#e53e3e` |
| Keyboard focus | `--border-interactive-selected` |

All icon-only actions are transparent in their default state. Table actions and the Dashboard refresh control also remain transparent on hover, using color change as their primary feedback. Header theme/language controls may use the shared OpenCode ghost-hover background. Do not add shadows, gradients, permanent borders, or standalone background colors.

The language dropdown is not an icon-only action surface; its menu items also use the shared OpenCode ghost-hover background.

## Interaction Rules

- Use a real `<button type="button">` for interactive icons.
- Give every icon-only button a localized `title` and matching `aria-label`.
- Keep the nested SVG decorative with `aria-hidden="true"`.
- Set `pointer-events: none` on the SVG so click targets remain on the button.
- Provide a visible `:focus-visible` outline.
- Keep the hit target larger than the rendered icon.
- Do not use an icon as the only indicator of a persistent application state when accompanying text is practical.
- A destructive color is applied on hover intent, not permanently.

## Icon Semantics

Current Portal names and intended meanings:

| Name | Meaning | Geometry |
|---|---|---|
| `info` | Instance details | Circled lowercase `i` |
| `refresh` | Reload latest Agent state | Two-part circular arrows |
| `sun` | Light color scheme | Center circle with eight rays |
| `moon` | Dark color scheme | Crescent |
| `system` | Follow operating-system scheme | Desktop display |
| `language` | Change interface language | Globe with latitude/longitude lines |
| `deploy` | Show Agent deployment commands | Terminal window and prompt |
| `edit` | Edit instance metadata | Diagonal pencil |
| `delete` | Permanently remove instance | Trash container |

Names describe intent, not appearance. For example, use `deploy`, not `terminal`, at the call site so future visual changes do not force API renaming.

## Implementation Pattern

Add paths and the name to `icons.ts`:

```ts
export type PortalIconName =
  | 'existing-icon'
  | 'new-action';

const PATHS: Record<PortalIconName, string> = {
  'existing-icon': '<path d="..."/>',
  'new-action': '<path d="..."/>',
};
```

Render icons only through the shared helper:

```ts
renderPortalIcon('new-action')
```

For HTML assembled in browser JavaScript, render the SVG server-side, serialize it with `safeJson`, and insert only that trusted constant. Do not construct SVG from registry metadata or other untrusted input.

## Prohibited Patterns

- Emoji or Unicode glyphs as UI icons, such as `⚙`, `✎`, `✕`, `↻`, or `ⓘ`.
- Platform-dependent icon fonts.
- External SVG files for small UI actions.
- Base64 or data-URL icons.
- Inline `style` attributes for icon color and sizing.
- Raw untrusted values inside SVG markup.
- Per-page copies of existing icon paths.
- Filled icons mixed into an outline action group without a documented semantic reason.

## Adding Or Changing An Icon

1. Confirm that no existing semantic icon fits the action.
2. Add the name and path data to `src/server/webui/icons.ts`.
3. Use the shared `renderPortalIcon()` helper at every SSR and client-rendered location.
4. Add or update the owning CSS class in `portal-css.ts`; do not style the path directly.
5. Add a localized `title` and `aria-label` to the button.
6. Extend `icons.test.ts` and the relevant page test.
7. For dynamic Dashboard rows, verify both initial SSR and SSE-driven rerendering.
8. Run type checking, Vitest, Shell E2E, and Playwright.

## Review Checklist

- [ ] Uses `renderPortalIcon()` and a registered semantic name.
- [ ] Uses the standard `24 x 24`, `1.6px`, round-stroke geometry.
- [ ] Remains legible at its final rendered size.
- [ ] Inherits `currentColor` and OpenCode theme tokens.
- [ ] Has no default background; hover behavior matches its control group.
- [ ] Has localized `title` and `aria-label` text.
- [ ] Has visible keyboard focus.
- [ ] Uses critical color only for destructive intent.
- [ ] Works in light and dark schemes.
- [ ] Has automated coverage for markup and behavior.
