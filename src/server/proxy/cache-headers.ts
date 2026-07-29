/**
 * Override upstream caching directives on proxied responses so the browser
 * always revalidates with the gateway before reusing a cached copy. Validators
 * such as ETag/Last-Modified are intentionally preserved.
 */
export function overrideCacheHeaders(headers: Record<string, string | string[]>): void {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'cache-control' || lower === 'pragma' || lower === 'expires') {
      delete headers[key];
    }
  }
  headers['cache-control'] = 'no-cache';
  headers['pragma'] = 'no-cache';
}
