import * as http from 'http';
import { createLogger, Logger } from '../../shared/logger';
import { readRequestBodyOrRespond, MAX_LOGIN_BODY_BYTES } from '../http/body';
import { detectPortalLocale } from '../webui/locale';
import { renderLoginPage } from '../webui/login-page';
import { AuthGate } from './gate';
import { sanitizeReturnTo } from './oidc-client';

const log: Logger = createLogger('gateway');

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_BACKOFF_MS = 60_000;

interface LoginFailureEntry {
  count: number;
  firstAttempt: number;
}

export class BrowserAuthRoutes {
  private loginFailures = new Map<string, LoginFailureEntry>();

  constructor(private authGate: AuthGate) {}

  async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    method: string,
    reqStart: number,
  ): Promise<boolean> {
    if (path === '/login' && method === 'GET') {
      this.serveLoginForm(req, res, false);
      log.info('http_response', 'login form served', { status: 200, duration_ms: Date.now() - reqStart });
      return true;
    }

    if (path === '/login' && method === 'POST') {
      if (!this.authGate.getSharedSecret()) {
        this.serveLoginForm(req, res, false, 'secret_disabled');
        log.info('auth_check_failed', 'login POST rejected — sharedSecret not configured');
        return true;
      }
      await this.handleLoginPost(req, res);
      return true;
    }

    if (path === '/auth/login') {
      const oidcClient = this.authGate.getOidcClient();
      if (oidcClient) {
        const returnParam = this.getReturnParam(req);
        const baseDomain = this.authGate.getBaseDomain();
        const returnTo = returnParam ? sanitizeReturnTo(decodeURIComponent(returnParam), baseDomain) : undefined;
        oidcClient.login(req, res, returnTo).catch(() => { res.writeHead(500).end('OIDC error'); });
        return true;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('OIDC not configured');
      return true;
    }

    if (path === '/auth/callback') {
      const oidcClient = this.authGate.getOidcClient();
      if (oidcClient) {
        oidcClient.handleCallback(req, res).catch(() => { res.writeHead(500).end('OIDC error'); });
        return true;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('OIDC not configured');
      return true;
    }

    if (path === '/auth/logout') {
      this.authGate.clearCookies(res, req.headers.host, this.isSecure(req));
      const oidcClient = this.authGate.getOidcClient();
      if (oidcClient) {
        oidcClient.logout(req, res);
        log.info('oidc_logout', 'user logged out', { duration_ms: Date.now() - reqStart });
        return true;
      }
      res.writeHead(302, { Location: '/login' });
      res.end();
      log.info('oidc_logout', 'user logged out', { duration_ms: Date.now() - reqStart });
      return true;
    }

    return false;
  }

  private serveLoginForm(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    error: boolean,
    reason?: 'secret_disabled' | 'rate_limited',
  ): void {
    const locale = detectPortalLocale(req);
    const returnParam = this.getReturnParam(req);
    const baseDomain = this.authGate.getBaseDomain();
    const returnTo = returnParam ? sanitizeReturnTo(decodeURIComponent(returnParam), baseDomain) : undefined;
    const html = renderLoginPage({
      locale,
      oidcMode: this.authGate.oidcMode,
      secretEnabled: !!this.authGate.getSharedSecret(),
      error,
      reason,
      baseDomain,
      returnTo,
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private async handleLoginPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = this.clientIp(req);
    if (!this.checkLoginRateLimit(clientIp)) {
      this.serveLoginForm(req, res, false, 'rate_limited');
      log.info('auth_check_failed', 'login rate limited', { clientIp });
      return;
    }

    const body = await readRequestBodyOrRespond(req, res, MAX_LOGIN_BODY_BYTES);
    if (body === null) return;
    const params = new URLSearchParams(body);
    const secret = params.get('secret') || '';
    const returnRaw = params.get('return') || '';
    const baseDomain = this.authGate.getBaseDomain();
    const returnTo = returnRaw ? sanitizeReturnTo(returnRaw, baseDomain) : '/';

    if (this.authGate.verifySharedSecret(secret)) {
      this.loginFailures.delete(clientIp);
      this.authGate.setAuthCookie(res, req.headers.host, this.isSecure(req));
      res.writeHead(302, { Location: returnTo });
      res.end();
      log.info('cookie_auth_set', 'login via form successful');
    } else {
      this.recordLoginFailure(clientIp);
      this.serveLoginForm(req, res, true);
      log.info('auth_check_failed', 'invalid login secret');
    }
  }

  private clientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (raw) {
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private checkLoginRateLimit(clientIp: string): boolean {
    const entry = this.loginFailures.get(clientIp);
    if (!entry) return true;
    if (Date.now() - entry.firstAttempt > LOGIN_BACKOFF_MS) {
      this.loginFailures.delete(clientIp);
      return true;
    }
    return entry.count < MAX_LOGIN_ATTEMPTS;
  }

  private recordLoginFailure(clientIp: string): void {
    const now = Date.now();
    const entry = this.loginFailures.get(clientIp);
    if (!entry || now - entry.firstAttempt > LOGIN_BACKOFF_MS) {
      this.loginFailures.set(clientIp, { count: 1, firstAttempt: now });
      return;
    }
    entry.count += 1;
  }

  private isSecure(req: http.IncomingMessage): boolean {
    return req.headers['x-forwarded-proto'] === 'https';
  }

  private getReturnParam(req: http.IncomingMessage): string | null {
    if (!req.url) return null;
    const qIndex = req.url.indexOf('?');
    if (qIndex < 0) return null;
    return new URLSearchParams(req.url.substring(qIndex)).get('return');
  }
}
