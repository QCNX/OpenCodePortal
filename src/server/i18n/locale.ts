import * as http from 'http';
import { parseCookies } from '../http/cookies';

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
  const normalized = decodeLocale(value.split(';')[0].split(',')[0]);
  if (normalized === 'zht' || normalized === 'zh-tw' || normalized === 'zh-hk' || normalized.startsWith('zh-hant')) {
    return 'zh-TW';
  }
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized.startsWith('zh-hans')) {
    return 'zh-CN';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return null;
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
