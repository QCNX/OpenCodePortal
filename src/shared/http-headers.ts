/** Join HTTP header values (Node may emit string or string[]). */
export function headerToString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

/** Parse a numeric header (e.g. content-length) into a non-negative number, or null. */
export function parseByteHeader(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** True when an upstream Content-Type should be streamed (not buffered). */
export function isEventStreamContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/event-stream');
}

/** Build an HTTP Basic Authorization header value from user:password (user defaults to 'opencode'). */
export function buildBasicAuthHeader(user: string | undefined, password: string): string {
  const username = user || 'opencode';
  return 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
}

/**
 * Parse the header block of a raw HTTP message — everything after the
 * request/status line — into a lowercase-keyed header map. Duplicate headers
 * are merged into arrays, matching Node's IncomingMessage behavior.
 * The first line (status/request line) is skipped.
 */
export function parseHeaderBlock(text: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  const lines = text.split('\r\n');
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      const key = lines[i].substring(0, colon).trim().toLowerCase();
      const value = lines[i].substring(colon + 1).trim();
      const existing = headers[key];
      if (existing === undefined) {
        headers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        headers[key] = [existing, value];
      }
    }
  }
  return headers;
}
