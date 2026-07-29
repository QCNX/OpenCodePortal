import * as http from 'http';
import * as crypto from 'crypto';
import type { OidcClient } from './oidc-client';
import { appendSetCookie, parseCookies } from '../http/cookies';
import { authCookieDomain } from '../http/host-routing';
import { createLogger, Logger } from '../../shared/logger';

const log: Logger = createLogger('gateway');
const COOKIE_AUTH = 'ocp_auth';

export interface UnauthenticatedResponseOptions {
  isSubdomain: boolean;
  reqStart?: number;
  method?: string;
  url?: string;
}

export interface WsUpgradeSocket {
  write(data: string): boolean;
  destroy(): void;
}

export class AuthGate {
  private oidcClient: OidcClient | null = null;
  private cookieSecret: Buffer;

  constructor(
    private sharedSecret: string | undefined,
    private baseDomain: string,
    cookieSecret?: string,
  ) {
    this.cookieSecret = cookieSecret
      ? Buffer.from(cookieSecret, 'base64')
      : crypto.randomBytes(32);
  }

  setOidcClient(client: OidcClient): void {
    this.oidcClient = client;
  }

  getOidcClient(): OidcClient | null {
    return this.oidcClient;
  }

  getSharedSecret(): string | undefined {
    return this.sharedSecret;
  }

  getBaseDomain(): string {
    return this.baseDomain;
  }

  get oidcMode(): boolean {
    return this.oidcClient !== null;
  }

  get authEnabled(): boolean {
    return this.oidcMode || !!this.sharedSecret;
  }

  setAuthCookie(res: http.ServerResponse, hostHeader?: string, secure?: boolean): void {
    const sig = crypto.createHmac('sha256', this.cookieSecret)
      .update(this.sharedSecret!)
      .digest('base64');
    const domain = authCookieDomain(hostHeader, this.baseDomain);
    const domainAttr = domain ? `; Domain=${domain}` : '';
    const secureAttr = secure ? '; Secure' : '';
    appendSetCookie(res, `${COOKIE_AUTH}=${sig}; Path=/; HttpOnly; SameSite=Lax${domainAttr}${secureAttr}`);
  }

  clearCookies(res: http.ServerResponse, hostHeader?: string, secure?: boolean): void {
    const domain = authCookieDomain(hostHeader, this.baseDomain);
    const domainAttr = domain ? `; Domain=${domain}` : '';
    const secureAttr = secure ? '; Secure' : '';
    appendSetCookie(res, `${COOKIE_AUTH}=; Path=/; HttpOnly; SameSite=Lax${domainAttr}${secureAttr}; Max-Age=0`);
  }

  checkBearerOrToken(req: http.IncomingMessage): boolean {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts[0] === 'Bearer' && parts.length > 1 && this.verifySharedSecret(parts[1])) {
        return true;
      }
    }

    if (req.url) {
      const qIndex = req.url.indexOf('?');
      if (qIndex >= 0) {
        const params = new URLSearchParams(req.url.substring(qIndex));
        const token = params.get('token');
        if (token && this.verifySharedSecret(token)) {
          return true;
        }
      }
    }

    return false;
  }

  checkAuthCookie(req: http.IncomingMessage): boolean {
    if (!this.sharedSecret) return false;
    const cookies = parseCookies(req);
    const val = cookies[COOKIE_AUTH];
    if (!val) return false;
    const expected = crypto.createHmac('sha256', this.cookieSecret)
      .update(this.sharedSecret)
      .digest('base64');
    return val === expected;
  }

  private timingSafeEqualStr(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  verifySharedSecret(candidate: string): boolean {
    if (!this.sharedSecret) return false;
    return this.timingSafeEqualStr(candidate, this.sharedSecret);
  }

  /** Returns base64(user:pass) from Authorization: Basic or ?auth_token= query. */
  extractBasicCredential(req: http.IncomingMessage): string | null {
    const h = req.headers['authorization'];
    if (h && h.startsWith('Basic ')) return h.slice('Basic '.length);

    if (req.url) {
      const q = req.url.indexOf('?');
      if (q >= 0) {
        const t = new URLSearchParams(req.url.slice(q)).get('auth_token');
        if (t) return t;
      }
    }
    return null;
  }

  checkBasicAuth(req: http.IncomingMessage): boolean {
    if (!this.sharedSecret) return false;
    const b64 = this.extractBasicCredential(req);
    if (!b64) return false;

    let decoded: string;
    try {
      decoded = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return false;
    }
    const i = decoded.indexOf(':');
    if (i < 0) return false;
    const password = decoded.slice(i + 1);
    return this.timingSafeEqualStr(password, this.sharedSecret);
  }

  isAuthenticated(req: http.IncomingMessage): boolean {
    if (this.oidcMode) {
      if (this.oidcClient!.getSession(req)) return true;
      if (this.sharedSecret && this.checkBearerOrToken(req)) return true;
      if (this.sharedSecret && this.checkAuthCookie(req)) return true;
      if (this.sharedSecret && this.checkBasicAuth(req)) return true;
      return false;
    }
    if (this.sharedSecret) {
      if (this.checkBearerOrToken(req)) return true;
      if (this.checkAuthCookie(req)) return true;
      if (this.checkBasicAuth(req)) return true;
      return false;
    }
    return true;
  }

  /**
   * Write the standard unauthenticated HTTP response. Returns true if a response was sent.
   */
  respondIfUnauthenticated(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: UnauthenticatedResponseOptions,
  ): boolean {
    if (req.method === 'OPTIONS') return false;

    if (this.isAuthenticated(req)) return false;

    const { isSubdomain, reqStart, method, url } = options;

    if (this.extractBasicCredential(req)) {
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="OpenCode Portal"',
      });
      res.end('Invalid credentials');
      log.info('auth_required', 'invalid basic credentials', {
        method: method ?? req.method ?? '?',
        url: url ?? req.url ?? '/',
        status: 401,
        duration_ms: reqStart !== undefined ? Date.now() - reqStart : undefined,
      });
      return true;
    }

    if (this.oidcMode || this.sharedSecret) {
      const url = options.url ?? req.url ?? '/';
      // Build the return-to URL so the login flow can send the user back.
      let returnTo: string;
      if (isSubdomain) {
        const host = (req.headers.host || '').replace(/:.*$/, ''); // strip port
        returnTo = `//${host}${url}`;
      } else {
        returnTo = url;
      }
      const returnParam = encodeURIComponent(returnTo);
      const location = isSubdomain
        ? `//${this.baseDomain}/login?return=${returnParam}`
        : `/login?return=${returnParam}`;
      res.writeHead(302, { Location: location });
      res.end();
      log.info(
        'auth_required',
        isSubdomain ? 'redirect to apex login' : 'redirect to login',
        {
          method: method ?? req.method ?? '?',
          url: url ?? req.url ?? '/',
          status: 302,
          duration_ms: reqStart !== undefined ? Date.now() - reqStart : undefined,
        },
      );
      return true;
    }

    res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' });
    res.end('Unauthorized');
    log.info('auth_required', 'unauthorized', {
      method: method ?? req.method ?? '?',
      url: url ?? req.url ?? '/',
      status: 401,
      duration_ms: reqStart !== undefined ? Date.now() - reqStart : undefined,
    });
    return true;
  }

  rejectWsUpgrade(socket: WsUpgradeSocket): void {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
}
