/**
 * 客户端 locale 归一化规则 —— 服务端 `parseLocale` 与浏览器注入脚本共用的单源。
 *
 * `exact` 为全等匹配列表（值已按小写、`_`→`-` 归一），`prefix` 为前缀匹配列表
 * （如 `zh-hant` 匹配 `zh-hant*`、`en-` 匹配 `en-*`）。规则互斥，数组顺序不代表
 * 优先级。该结构可直接 JSON 序列化（配合 `safeJson`）注入导航脚本，
 * 客户端运行时按同一张表匹配，避免规则双份维护后漂移。
 */
export const CLIENT_LOCALE_RULES: ReadonlyArray<{
  locale: 'zh-CN' | 'zh-TW' | 'en';
  exact: readonly string[];
  prefix: readonly string[];
}> = [
  { locale: 'zh-TW', exact: ['zht', 'zh-tw', 'zh-hk'], prefix: ['zh-hant'] },
  { locale: 'zh-CN', exact: ['zh', 'zh-cn', 'zh-sg'], prefix: ['zh-hans'] },
  { locale: 'en', exact: ['en'], prefix: ['en-'] },
];

export type ClientLocale = 'zh-CN' | 'zh-TW' | 'en';

/**
 * 将单个 locale 值归一化为受支持的 locale。
 *
 * 输入必须是已解码、未切割的单个值：`decodeURIComponent`、Accept-Language 的
 * 分号/逗号切割、trim 由调用方负责（服务端在 `src/server/i18n/locale.ts` 的
 * `decodeLocale`/`parseLocale` 中处理，浏览器端在注入脚本的 `normalizeLocale`
 * 中对 cookie 值 decode）。函数内部自行完成小写化与 `_` → `-` 归一。
 * 未知或空值返回 null。
 *
 * 注：注入浏览器的客户端版 `normalizeLocale` 语义与此一致，但返回 `''`
 * （空串）而非 null，以兼容 `detectLocale` 中的 `||` 兜底。
 */
export function normalizeClientLocale(value: string): ClientLocale | null {
  const lang = value.toLowerCase().replace(/_/g, '-');
  for (const rule of CLIENT_LOCALE_RULES) {
    if (rule.exact.includes(lang)) return rule.locale;
    if (rule.prefix.some((p) => lang.startsWith(p))) return rule.locale;
  }
  return null;
}
