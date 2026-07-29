// ---------------------------------------------------------------------------
// Portal CSS — OpenCode-compatible design tokens and components
// ---------------------------------------------------------------------------
// Exports a CSS string served at GET /portal.css on the Gateway apex.
// All color/spacing/typography values are extracted from a running OpenCode
// instance (v1.15.9) via getComputedStyle() in both light and dark modes.
// ---------------------------------------------------------------------------

export const PORTAL_CSS = `/* OpenCode Portal — Design Tokens */

/* --- Light theme (default) --- */
:root {
  /* Typography */
  --font-family-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --font-size-small: 13px;
  --font-size-base: 14px;
  --font-size-large: 16px;
  --font-weight-medium: 500;
  --line-height-large: 150%;
  --letter-spacing-normal: 0;

  /* Border radius */
  --radius-xs: .125rem;
  --radius-sm: .25rem;
  --radius-md: .375rem;
  --radius-lg: .5rem;

  /* Surfaces */
  --surface-base: #F8F8F8;
  --surface-raised-base: #F3F3F3;
  --surface-raised-stronger-non-alpha: #ffffff;
  --surface-inset-base: #ebebeb;
  --surface-inset-strong: rgba(230, 230, 230, 0.09);

  /* Text */
  --text-stronger: #171717;
  --text-strong: #171717;
  --text-weak: #8F8F8F;
  --text-weaker: #C7C7C7;
  --icon-base: #8F8F8F;

  /* Borders */
  --border-weak-base: #DBDBDB;
  --border-weak-hover: #cfcecd;
  --border-weak-focus: #c1c0c0;
  --border-strong-base: #a6a5a4;
  --border-strong-hover: #999796;
  --border-interactive-selected: #054dfd;

  /* Buttons */
  --button-primary-base: #1d1917;
  --button-secondary-base: #ededed;
  --button-secondary-hover: #e4e4e4;
  --button-ghost-hover: #ebebeb;

  /* Inputs */
  --input-base: #f8f8f8;
  --input-hover: #f2f2f2;

  /* Shadows */
  --shadow-xs: 0 1px 2px -.5px #0000000a, 0 .5px 1.5px 0 #00000006, 0 1px 3px 0 #0000000d;
  --shadow-md: 0 6px 12px -2px #00000013, 0 4px 8px -2px #00000013, 0 1px 2px #0000001a;
  --shadow-lg: 0 16px 48px -6px #0000000d, 0 6px 12px -2px #00000006, 0 1px 2.5px #00000006;

  /* ---- v2 design tokens (newer OpenCode component system) ---- */
  --v2-text-text-base: #171717;
  --v2-text-text-muted: #8F8F8F;
  --v2-text-text-contrast: #fff;
  --v2-background-bg-base: #ffffff;
  --v2-background-bg-layer-02: #f3f3f3;
  --v2-background-bg-button-neutral: #f3f3f3;
  --v2-background-bg-contrast: #1d1917;
  --v2-border-border-base: #DBDBDB;
  --v2-border-border-focus: #054dfd;
  --v2-overlay-simple-overlay-hover: #00000008;
  --v2-overlay-simple-overlay-pressed: #0000000f;
  --v2-state-fg-success: #198b43;
  --v2-state-fg-critical: #dc2626;

  color-scheme: light;
}

/* --- Dark theme --- */
[data-color-scheme="dark"] {
  --surface-base: #1C1C1C;
  --surface-raised-base: #232323;
  --surface-raised-stronger-non-alpha: #191919;
  --surface-inset-base: #202020;
  --surface-inset-strong: rgba(18, 18, 18, 0.5);
  --text-stronger: #EDEDED;
  --text-strong: #EDEDED;
  --text-weak: #707070;
  --text-weaker: #505050;
  --icon-base: #7E7E7E;
  --border-weak-base: #282828;
  --border-weak-hover: #444342;
  --border-weak-focus: #4d4c4a;
  --border-strong-base: #5f5d5c;
  --border-strong-hover: #686664;
  --border-interactive-selected: #1456f7;
  --button-primary-base: #ede8e4;
  --button-secondary-base: #353535;
  --button-secondary-hover: #3d3d3d;
  --button-ghost-hover: #202020;
  --input-base: #151515;
  --input-hover: #191919;
  --shadow-xs: 0 1px 2px -.5px #0000000f, 0 .5px 1.5px 0 #00000014, 0 1px 3px 0 #0000001a;
  --shadow-md: 0 6px 12px -2px #0000001a, 0 4px 8px -2px #00000026, 0 1px 2px #00000026;
  --shadow-lg: 0 16px 48px -6px #00000026, 0 6px 12px -2px #0000001a, 0 1px 2.5px #0000001a;

  --v2-text-text-base: #fafafa;
  --v2-text-text-muted: #aeaeae;
  --v2-text-text-contrast: #fff;
  --v2-background-bg-base: #161616;
  --v2-background-bg-layer-02: #3a3a3a;
  --v2-background-bg-button-neutral: #3a3a3a;
  --v2-background-bg-contrast: #ede8e4;
  --v2-border-border-base: #ffffff1a;
  --v2-border-border-focus: #1456f7;
  --v2-overlay-simple-overlay-hover: #ffffff0f;
  --v2-overlay-simple-overlay-pressed: #ffffff1a;
  --v2-state-fg-success: #6bd586;
  --v2-state-fg-critical: #f17471;

  color-scheme: dark;
}

/* ==================================================================
   Components
   ================================================================== */

/* --- Body base --- */
.portal-body {
  background: var(--surface-base);
  color: var(--text-stronger);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-large);
  margin: 0;
}

/* --- Links --- */
.portal-link {
  color: var(--border-interactive-selected);
  text-decoration: none;
}
.portal-link:hover { text-decoration: underline; }

/* --- Button (aligned with OpenCode button-v2) --- */
[data-component="button-v2"] {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: 530;
  line-height: 1;
  color: var(--v2-text-text-base);
  letter-spacing: -0.04px;
  user-select: none;
  cursor: pointer;
  text-decoration: none;
}
[data-component="button-v2"]:focus { outline: none; }
[data-component="button-v2"]:focus-visible {
  outline: 2px solid var(--v2-border-border-focus);
  outline-offset: 2.5px;
}

/* Sizes */
[data-component="button-v2"][data-size="small"] {
  height: 24px; padding: 0 9px; border-radius: var(--radius-sm);
}
[data-component="button-v2"][data-size="normal"] {
  height: 28px; padding: 0 11px;
}
[data-component="button-v2"][data-size="large"] {
  height: 32px; padding: 0 15px;
}

/* Variant: neutral (default secondary) */
[data-component="button-v2"][data-variant="neutral"] {
  background: var(--v2-background-bg-button-neutral);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--v2-border-border-base);
}
[data-component="button-v2"][data-variant="neutral"]:hover:not(:disabled) {
  background-image: linear-gradient(var(--v2-overlay-simple-overlay-hover), var(--v2-overlay-simple-overlay-hover));
}
[data-component="button-v2"][data-variant="neutral"]:active:not(:disabled) {
  background-image: linear-gradient(var(--v2-overlay-simple-overlay-pressed), var(--v2-overlay-simple-overlay-pressed));
}

/* Variant: contrast (primary / CTA) */
[data-component="button-v2"][data-variant="contrast"] {
  background: var(--v2-background-bg-contrast);
  color: var(--surface-raised-stronger-non-alpha);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--v2-border-border-base);
}
[data-component="button-v2"][data-variant="contrast"]:hover:not(:disabled) {
  opacity: 0.9;
}

/* Variant: ghost */
[data-component="button-v2"][data-variant="ghost"] {
  background: transparent;
}
[data-component="button-v2"][data-variant="ghost"]:hover:not(:disabled) {
  background: var(--button-ghost-hover);
}

/* Variant: ghost muted */
[data-component="button-v2"][data-variant="ghost-muted"] {
  background: transparent;
  color: var(--v2-text-text-muted);
}
[data-component="button-v2"][data-variant="ghost-muted"]:hover:not(:disabled) {
  background: var(--button-ghost-hover);
}

/* Portal semantic extension: critical actions keep a valid v2 variant. */
[data-component="button-v2"][data-tone="critical"] {
  color: var(--v2-state-fg-critical);
}
[data-component="button-v2"][data-tone="critical"][data-variant="contrast"] {
  background: var(--v2-state-fg-critical);
  color: #fff;
  box-shadow: var(--shadow-xs);
}
[data-component="button-v2"][data-tone="critical"][data-variant="contrast"]:hover:not(:disabled) {
  opacity: 0.85;
}

/* Ensure action buttons in table cells have consistent spacing */
.actions-cell {
  white-space: nowrap;
}
.actions-cell button {
  margin-right: 4px;
}
.actions-cell button:last-child {
  margin-right: 0;
}

/* Disabled */
[data-component="button-v2"]:disabled {
  opacity: 0.5; cursor: not-allowed;
}

/* --- Button group --- */
.portal-button-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  justify-content: flex-end;
}

/* --- Input (aligned with OpenCode input-v2) --- */
[data-component="input-v2"] {
  width: 100%;
  background: var(--input-base);
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  color: var(--text-stronger);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  padding: 7px 10px;
  outline: none;
  box-sizing: border-box;
}
[data-component="input-v2"]:hover { border-color: var(--border-weak-hover); }
[data-component="input-v2"]:focus {
  border-color: var(--border-interactive-selected);
  box-shadow: 0 0 0 3px rgba(5,77,253,0.15);
}
[data-component="input-v2"]::placeholder { color: var(--text-weaker); }
[data-component="input-v2"]:disabled {
  opacity: 0.5; cursor: not-allowed;
}

/* --- Select --- */
.portal-select {
  background: var(--input-base);
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  color: var(--text-stronger);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  padding: 7px 28px 7px 10px;
  appearance: none;
  cursor: pointer;
  outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238F8F8F'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}
.portal-select:hover { border-color: var(--border-weak-hover); }
.portal-select:focus {
  border-color: var(--border-interactive-selected);
  box-shadow: 0 0 0 3px rgba(5,77,253,0.15);
}

/* --- Card --- */
.portal-card {
  background: var(--surface-raised-stronger-non-alpha);
  border: 1px solid var(--border-weak-base);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}

/* --- Table --- */
.portal-table {
  width: 100%;
  border-collapse: collapse;
}
.portal-table th {
  color: var(--text-weak);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-weak-base);
  text-align: left;
}
.portal-table th.sortable { cursor: pointer; user-select: none; }
.portal-table th.sortable:hover { color: var(--text-stronger); }
.portal-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-weak-base);
  color: var(--text-stronger);
  font-size: var(--font-size-small);
}
.portal-table tr:last-child td { border-bottom: none; }

/* --- Chip / Tag --- */
.portal-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-inset-base);
  color: var(--text-weak);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  border: none;
}
.portal-chip:hover { color: var(--text-stronger); }
.portal-chip.active {
  background: var(--border-interactive-selected);
  color: #fff;
}

/* --- Status dot --- */
.portal-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.portal-status-dot.online { background: var(--v2-state-fg-success); }
.portal-status-dot.offline { background: var(--v2-state-fg-critical); }

/* --- Divider --- */
.portal-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-weaker);
  font-size: var(--font-size-small);
}
.portal-divider::before,
.portal-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-weak-base);
}

/* --- Error message --- */
.portal-error {
  background: color-mix(in srgb, var(--v2-state-fg-critical) 10%, transparent);
  border: 1px solid var(--v2-state-fg-critical);
  color: var(--v2-state-fg-critical);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-small);
}

/* --- Modal overlay --- */
.portal-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  display: none; align-items: center; justify-content: center;
  z-index: 9999; pointer-events: none;
}
.portal-modal-overlay.visible {
  display: flex; pointer-events: auto;
}
.portal-modal-overlay.visible { display: flex; }

/* --- Modal --- */
.portal-modal {
  max-width: 90vw;
  width: 420px;
  padding: 24px;
}
.portal-modal h2 {
  margin: 0 0 16px 0;
  font-size: var(--font-size-large);
  font-weight: 530;
  color: var(--text-stronger);
}
.portal-modal .row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-weak-base);
  font-size: var(--font-size-small);
}
.portal-modal .row .key { color: var(--text-weak); }
.portal-modal .row .val {
  color: var(--text-stronger);
  text-align: right;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Portal line icons and icon buttons --- */
.portal-svg-icon {
  display: block;
  width: 16px;
  height: 16px;
  flex: none;
  pointer-events: none;
}
.portal-icon-btn,
.portal-theme-toggle,
.portal-lang-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--icon-base);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
}
.portal-icon-btn:focus-visible,
.portal-theme-toggle:focus-visible,
.portal-lang-btn:focus-visible,
.portal-row-action:focus-visible,
.portal-detail-action:focus-visible {
  outline: 2px solid var(--border-interactive-selected);
  outline-offset: 1px;
}

.portal-row-action,
.portal-detail-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-weaker);
  cursor: pointer;
  vertical-align: middle;
}
.portal-row-action {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
}
.portal-detail-action {
  width: 20px;
  height: 20px;
  margin-left: 2px;
  border-radius: var(--radius-xs);
}
.portal-detail-action .portal-svg-icon {
  width: 14px;
  height: 14px;
}
.portal-row-action:hover,
.portal-detail-action:hover {
  background: transparent;
  color: var(--text-stronger);
}
.portal-row-action-danger:hover {
  color: var(--v2-state-fg-critical, #e53e3e);
}

/* --- Tabs --- */
.portal-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-weak-base);
  margin-bottom: 12px;
}
.portal-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-weak);
  cursor: pointer;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: 530;
  padding: 6px 14px;
  transition: color 0.15s, border-color 0.15s;
}
.portal-tab:hover { color: var(--text-normal); }
.portal-tab.active {
  color: var(--text-stronger);
  border-bottom-color: var(--border-interactive-selected);
}
.deploy-method-tabs {
  width: 100%;
}
.deploy-method-tabs .portal-tab {
  flex: 1 1 50%;
  text-align: center;
}

/* Code block (deploy commands) */
.deploy-code {
  background: var(--surface-inset-base);
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-sm);
  color: var(--text-normal, #ccc);
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  position: relative;
  white-space: pre-wrap;
  word-break: break-all;
}
.deploy-tab-panel .deploy-code {
  max-height: none;
}
.deploy-tab-panel .deploy-code + .deploy-code,
.deploy-tab-panel > .deploy-code:not(:last-child) {
  margin-bottom: 16px;
}
.deploy-tab-panel > div:not(.deploy-code) {
  font-size: var(--font-size-small);
  font-weight: 600;
  margin-bottom: 8px;
}
.deploy-section-title {
  color: var(--text-stronger);
  font-size: var(--font-size-small);
  font-weight: 600;
  margin: 12px 0 8px;
}
.deploy-tab-panel > .deploy-section-title:first-child {
  margin-top: 0;
}
.deploy-upgrade-guide {
  border-top: 1px solid var(--border-weak-base);
  margin-top: 20px;
  padding-top: 16px;
}
.deploy-upgrade-guide h3 {
  color: var(--text-stronger);
  font-size: var(--font-size-base);
  font-weight: 600;
  margin: 0 0 10px;
}
.deploy-upgrade-guide ol {
  color: var(--text-normal);
  font-size: var(--font-size-small);
  line-height: 1.6;
  margin: 0;
  padding-left: 22px;
}
.deploy-upgrade-guide li + li {
  margin-top: 4px;
}
.deploy-upgrade-note {
  border-left: 3px solid var(--border-interactive-selected);
  color: var(--text-weak);
  font-size: var(--font-size-small);
  line-height: 1.5;
  margin: 12px 0;
  padding: 6px 10px;
}
.portal-icon-btn:hover,
.portal-theme-toggle:hover,
.portal-lang-btn:hover {
  background: var(--button-ghost-hover);
  color: var(--text-stronger);
}

/* --- Language dropdown --- */
.portal-lang-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 100px;
  background: var(--surface-raised-stronger-non-alpha);
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 200;
  overflow: hidden;
}
.portal-lang-dropdown.visible { display: block; }
.portal-lang-dropdown button {
  display: block;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--text-stronger);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  cursor: pointer;
  text-align: left;
}
.portal-lang-dropdown button:hover {
  background: var(--button-ghost-hover);
}
.portal-lang-dropdown button.active {
  color: var(--border-interactive-selected);
}

/* --- Version badge --- */
.portal-version {
  font-size: var(--font-size-small);
  color: var(--text-weak);
  font-family: var(--font-family-sans);
  line-height: 1;
  user-select: all;
}
.portal-version--footer {
  margin-top: 20px;
  text-align: center;
}

/* --- Dashboard status refresh --- */
.portal-status-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-weak);
  cursor: pointer;
}
.portal-status-refresh .portal-svg-icon {
  width: 17px;
  height: 17px;
}
.portal-status-refresh:hover {
  background: transparent;
  color: var(--text-stronger);
}
.portal-status-refresh:focus-visible {
  outline: 2px solid var(--border-interactive-selected);
  outline-offset: 1px;
}

/* --- Sort arrow --- */
.portal-sort-arrow {
  margin-left: 4px;
  font-size: 10px;
  color: var(--text-weaker);
}
`;
