import { describe, expect, it } from 'vitest';
import { CLIENT_LOCALE_RULES, normalizeClientLocale } from './locale';

describe('normalizeClientLocale', () => {
  it.each([
    ['zh', 'zh-CN'],
    ['zh-cn', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh_sg', 'zh-CN'],
    ['zh-sg', 'zh-CN'],
    ['zh-hans', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
    ['zht', 'zh-TW'],
    ['zh-tw', 'zh-TW'],
    ['zh_TW', 'zh-TW'],
    ['zh-hk', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['EN', 'en'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeClientLocale(input)).toBe(expected);
  });

  it('returns null for unknown or empty values', () => {
    expect(normalizeClientLocale('fr')).toBeNull();
    expect(normalizeClientLocale('fr-FR')).toBeNull();
    expect(normalizeClientLocale('zh-xx')).toBeNull();
    expect(normalizeClientLocale('')).toBeNull();
  });

  it('does not prefix-match en against bare en- only values or lookalikes', () => {
    // 'en' exact is in the rules; 'english' must not be treated as en (no 'en' prefix rule)
    expect(normalizeClientLocale('english')).toBeNull();
  });
});

describe('CLIENT_LOCALE_RULES', () => {
  it('is serializable to plain JSON for script injection', () => {
    expect(JSON.stringify(CLIENT_LOCALE_RULES)).toBe(
      '[{"locale":"zh-TW","exact":["zht","zh-tw","zh-hk"],"prefix":["zh-hant"]},' +
        '{"locale":"zh-CN","exact":["zh","zh-cn","zh-sg"],"prefix":["zh-hans"]},' +
        '{"locale":"en","exact":["en"],"prefix":["en-"]}]',
    );
  });
});
