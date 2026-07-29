/**
 * Remove a query parameter from a request path (path + optional ?query).
 * Preserves other parameters and path-only URLs.
 */
export function stripQueryParam(url: string, name: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;

  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  params.delete(name);
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}
