import { en } from './locales/en';
import { zhCN } from './locales/zh-cn';
import { zhTW } from './locales/zh-tw';
import type { TranslationSchema } from './schema';
import type { PortalLocale } from './locale';

export {
  DEFAULT_LOCALE,
  LOCALE_META,
  SUPPORTED_LOCALES,
  detectPortalLocale,
  getHtmlLang,
  normalizeLocale,
  parseLocale,
} from './locale';
export type { PortalLocale } from './locale';
export type { CommonTranslations, DashboardTranslations, LoginTranslations, NavTranslations, TranslationSchema } from './schema';

export const TRANSLATIONS: Record<PortalLocale, TranslationSchema> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
};

export function getTranslations(locale: PortalLocale): TranslationSchema {
  return TRANSLATIONS[locale];
}

export interface ClientNavTranslations {
  dash: string;
  switch: string;
  refresh: string;
  logout: string;
  offline: string;
}

export function getClientNavTranslations(): Record<PortalLocale, ClientNavTranslations> {
  return Object.fromEntries(
    Object.entries(TRANSLATIONS).map(([locale, translations]) => [
      locale,
      {
        dash: translations.nav.dashboard,
        switch: translations.nav.switchInstance,
        refresh: translations.nav.refresh,
        logout: translations.common.logout,
        offline: translations.nav.offline,
      },
    ]),
  ) as Record<PortalLocale, ClientNavTranslations>;
}
