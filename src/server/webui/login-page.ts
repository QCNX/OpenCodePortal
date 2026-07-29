import { formatPortalVersionLabel, getPortalVersion } from '../../shared/version';
import { escapeAttr, escapeHtml } from './escape';
import { getHtmlLang, getTranslations, type PortalLocale } from '../i18n';
import { renderLanguageOptions, renderLanguageSwitcherScript, renderThemeToggleScript } from './shared-scripts';
import { renderPortalIcon } from './icons';

export interface LoginPageModel {
  locale: PortalLocale;
  oidcMode: boolean;
  secretEnabled: boolean;
  error: boolean;
  reason?: 'secret_disabled' | 'rate_limited';
  baseDomain: string;
  returnTo?: string; // post-login redirect target (already sanitized by caller)
}

export function renderLoginPage(model: LoginPageModel): string {
  const locale = model.locale;
  const translations = getTranslations(locale);
  const t = { ...translations.common, ...translations.login };

  const showOidc = model.oidcMode;
  const secretEnabled = model.secretEnabled;
  const showDivider = showOidc && secretEnabled;

  const errorHtml = model.error
    ? `<div class="portal-error">${escapeHtml(t.errorBad)}</div>`
    : model.reason === 'secret_disabled'
      ? `<div class="portal-error">${escapeHtml(t.errorDisabled)}</div>`
      : model.reason === 'rate_limited'
        ? `<div class="portal-error">${escapeHtml(t.errorRateLimited)}</div>`
        : '';

  const oidcReturnParam = model.returnTo ? `?return=${encodeURIComponent(model.returnTo)}` : '';
  const oidcHtml = showOidc
    ? `<a href="/auth/login${oidcReturnParam}" data-component="button-v2" data-variant="contrast" data-size="large" style="width:100%;margin-bottom:${showDivider ? '12px' : '0'}">${escapeHtml(t.oidc)}</a>`
    : '';

  const dividerHtml = showDivider
    ? `<div class="portal-divider"><span>${escapeHtml(t.divider)}</span></div>`
    : '';

  const secretDisabledAttr = secretEnabled ? '' : ' disabled';
  const secretPlaceholder = secretEnabled ? t.secretPlaceholder : t.secretDisabled;
  const submitDisabledAttr = secretEnabled ? '' : ' disabled';
  const returnHiddenField = model.returnTo
    ? `<input type="hidden" name="return" value="${escapeAttr(model.returnTo)}">`
    : '';
  const autofocusAttr = !showOidc && secretEnabled ? ' autofocus' : '';
  const langAttr = getHtmlLang(locale);
  const versionLabel = formatPortalVersionLabel(getPortalVersion());

  return `<!DOCTYPE html>
<html lang="${langAttr}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(t.pageTitle)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/portal.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .login-wrapper { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  </style>
</head>
<body class="portal-body">
  <div class="login-wrapper">
    <div class="portal-card" style="width: 360px; padding: 32px; position: relative;">
      <div style="position:absolute;top:8px;right:12px;display:flex;align-items:center;gap:4px;">
        <button type="button" class="portal-theme-toggle" id="theme-toggle" title="${escapeAttr(t.themeSystem)}" aria-label="${escapeAttr(t.themeSystem)}">${renderPortalIcon('system')}</button>
        <span style="position:relative;">
          <button type="button" class="portal-lang-btn" id="lang-btn" title="${escapeAttr(t.language)}" aria-label="${escapeAttr(t.language)}">${renderPortalIcon('language')}</button>
          <div class="portal-lang-dropdown" id="lang-dropdown">
            ${renderLanguageOptions(locale)}
          </div>
        </span>
      </div>
      <h1 style="font-size: var(--font-size-large); font-weight: 530; color: var(--text-stronger); margin-bottom: 4px;">OpenCode Portal</h1>
      <p style="color: var(--text-weak); font-size: var(--font-size-small); margin-bottom: 20px;">${escapeHtml(t.login)}</p>
      ${errorHtml}
      ${oidcHtml}
      ${dividerHtml}
      <form method="POST" action="/login">
        ${returnHiddenField}
        <div style="margin-bottom: 12px;">
          <label for="secret" style="display:block; font-size:12px; color:var(--text-weak); margin-bottom:4px;">${escapeHtml(t.secretLabel)}</label>
          <input type="password" id="secret" name="secret" data-component="input-v2" placeholder="${escapeAttr(secretPlaceholder)}"${secretDisabledAttr}${autofocusAttr}>
        </div>
        <button type="submit" data-component="button-v2" data-variant="neutral" data-size="large" style="width:100%"${submitDisabledAttr}>${escapeHtml(t.submit)}</button>
      </form>
      <p class="portal-version portal-version--footer">${escapeHtml(versionLabel)}</p>
    </div>
  </div>
${renderThemeToggleScript(t)}
${renderLanguageSwitcherScript(model.baseDomain)}
</body>
</html>`;
}
