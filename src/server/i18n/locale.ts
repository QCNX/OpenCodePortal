import * as http from 'http';
import { parseCookies } from '../http/cookies';
import { normalizeClientLocale } from '../../shared/locale';

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
export type PortalLocale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: PortalLocale = 'zh-CN';

export const LOCALE_META: Record<PortalLocale, { label: string; htmlLang: string }> = {
  'zh-CN': { label: '简体中文', htmlLang: 'zh-CN' },
  'zh-TW': { label: '繁體中文', htmlLang: 'zh-TW' },
  en: { label: 'English', htmlLang: 'en' },
};

function decodeLocale(value: string): string {
  try {
    return decodeURIComponent(value).trim().toLowerCase().replace(/_/g, '-');
  } catch {
    return value.trim().toLowerCase().replace(/_/g, '-');
  }
}

export function parseLocale(value?: string | null): PortalLocale | null {
  if (!value) return null;
  // 切割与 URL 解码保留在 i18n 层；匹配规则单源在 shared 的 normalizeClientLocale。
  const normalized = decodeLocale(value.split(';')[0].split(',')[0]);
  return normalizeClientLocale(normalized);
}

export function normalizeLocale(value?: string | null): PortalLocale {
  return parseLocale(value) ?? DEFAULT_LOCALE;
}

/** Detect locale from the shared language cookie, then Accept-Language. */
export function detectPortalLocale(req: http.IncomingMessage): PortalLocale {
  const cookieLocale = parseLocale(parseCookies(req).language);
  if (cookieLocale) return cookieLocale;

  const accept = req.headers['accept-language'];
  if (accept) {
    for (const candidate of accept.split(',')) {
      const locale = parseLocale(candidate.trim());
      if (locale) return locale;
    }
  }
  return DEFAULT_LOCALE;
}

export function getHtmlLang(locale: PortalLocale): string {
  return LOCALE_META[locale].htmlLang;
}
