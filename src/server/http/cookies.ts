import * as http from 'http';

/** Parse cookies from request headers. */
export function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  const parts = (Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader).split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      result[part.substring(0, eq).trim()] = part.substring(eq + 1).trim();
    }
  }
  return result;
}

export function appendSetCookie(res: http.ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const cookies = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
  cookies.push(cookie);
  res.setHeader('Set-Cookie', cookies);
}
