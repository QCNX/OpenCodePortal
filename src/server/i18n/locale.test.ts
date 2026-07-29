import { describe, expect, it } from 'vitest';
import { detectPortalLocale, getHtmlLang, normalizeLocale, parseLocale } from '.';
import { createMockReq } from '../test-helpers';

describe('portal locale', () => {
  it.each([
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
    ['zht', 'zh-TW'],
    ['zh_TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['en', 'en'],
    ['en-US', 'en'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(parseLocale(input)).toBe(expected);
  });

  it('uses the default locale for unknown values', () => {
    expect(parseLocale('fr')).toBeNull();
    expect(normalizeLocale('fr')).toBe('zh-CN');
  });

  it('prefers the language cookie over Accept-Language', () => {
    const req = createMockReq('/', 'GET', {
      host: 'portal.example.com',
      cookie: 'language=zh-TW',
      'accept-language': 'en-US,en;q=0.9',
    });
    expect(detectPortalLocale(req)).toBe('zh-TW');
  });

  it('checks Accept-Language candidates in order', () => {
    const req = createMockReq('/', 'GET', {
      host: 'portal.example.com',
      'accept-language': 'fr-FR, en-US;q=0.9, zh-CN;q=0.8',
    });
    expect(detectPortalLocale(req)).toBe('en');
  });

  it('maps locales to HTML language tags', () => {
    expect(getHtmlLang('zh-CN')).toBe('zh-CN');
    expect(getHtmlLang('zh-TW')).toBe('zh-TW');
    expect(getHtmlLang('en')).toBe('en');
  });
});
