// ---------------------------------------------------------------------------
// Gateway — OIDC authentication (Authentik SSO)
// ---------------------------------------------------------------------------
//
// Single-user SSO via Authentik (or any OIDC provider). Authorization-code
// flow with PKCE + state + nonce. Who may log in is enforced by the Authentik
// application's authorization policy — the Gateway does not maintain a user
// allowlist. The session cookie is scoped to `.<baseDomain>` so a single login
// works across the apex Dashboard and every instance subdomain.
// ---------------------------------------------------------------------------

import * as crypto from 'crypto';
import * as http from 'http';
import * as oidc from 'openid-client';
import { OidcConfig } from '../../shared/types';
import { createLogger, Logger } from '../../shared/logger';
import { authCookieDomain } from '../http/host-routing';
import { appendSetCookie, parseCookies, isSecureRequest } from '../http/cookies';

const log: Logger = createLogger('gateway');

const SESSION_COOKIE = 'ocp_session';
const TX_COOKIE = 'ocp_oidc_tx'; // short-lived login transaction (PKCE/state/nonce)
const TX_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// -- Session types ------------------------------------------------------------

interface Session {
  id: string;
  user: { sub: string; name?: string; email?: string };
  accessToken: string;
  refreshToken?: string;
  expires: number;
}

interface LoginTx {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expires: number;
}

// -- Session store (in-memory with TTL cleanup) -------------------------------

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 300_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    // Don't keep the event loop alive solely for cleanup.
    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
  }

  create(user: { sub: string; name?: string; email?: string }, accessToken: string, refreshToken?: string): string {
    const id = crypto.randomBytes(32).toString('hex');
    this.sessions.set(id, { id, user, accessToken, refreshToken, expires: Date.now() + SESSION_TTL_MS });
    return id;
  }

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (s && Date.now() > s.expires) { this.sessions.delete(id); return undefined; }
    return s;
  }

  delete(id: string): void { this.sessions.delete(id); }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) { if (now > s.expires) this.sessions.delete(id); }
  }

  destroy(): void { clearInterval(this.cleanupTimer); this.sessions.clear(); }
}

// -- OIDC Client --------------------------------------------------------------

export class OidcClient {
  private config: oidc.Configuration | null = null;
  private sessionStore = new SessionStore();
  private baseUrl = '';
  private redirectUri = '';
  private scopes = 'openid profile email';
  private cookieDomain = '';
  // HMAC key for signing the transient login-transaction cookie. Regenerated
  // each process start — pending logins survive only within one Gateway run.
  private txSecret = crypto.randomBytes(32);

  async init(oidcCfg: OidcConfig, baseUrl: string, baseDomain: string): Promise<void> {
    this.baseUrl = baseUrl;
    this.redirectUri = oidcCfg.redirectUri;
    this.cookieDomain = baseDomain;
    if (oidcCfg.scopes && oidcCfg.scopes.length > 0) {
      this.scopes = oidcCfg.scopes.join(' ');
    }
    const discoveryOptions = oidcCfg.allowInsecureIssuer
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined;
    this.config = await oidc.discovery(
      new URL(oidcCfg.issuer),
      oidcCfg.clientId,
      oidcCfg.clientSecret,
      undefined,
      discoveryOptions,
    );
    if (oidcCfg.allowInsecureIssuer) {
      oidc.allowInsecureRequests(this.config);
    }
    log.info('oidc_ready', 'oidc initialized', {
      issuer: this.config.serverMetadata().issuer,
      scopes: this.scopes,
    });
  }

  /** Begin the auth-code flow: set a signed PKCE/state/nonce cookie and redirect to the IdP. */
  async login(req: http.IncomingMessage, res: http.ServerResponse, returnTo = '/'): Promise<void> {
    if (!this.config) throw new Error('OIDC not initialized');

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const tx: LoginTx = { state, nonce, codeVerifier, returnTo: sanitizeReturnTo(returnTo, this.cookieDomain), expires: Date.now() + TX_TTL_MS };

    const redirectUrl = oidc.buildAuthorizationUrl(this.config, {
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    this.setTxCookie(res, tx, req.headers.host, isSecureRequest(req));
    res.writeHead(302, { Location: redirectUrl.href });
    res.end();
  }

  async handleCallback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.config) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('OIDC not configured');
      return;
    }

    const tx = this.readTxCookie(req);
    if (!tx) {
      this.clearTxCookie(res, req.headers.host, isSecureRequest(req));
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Login session expired or missing — please retry.');
      log.warn('oidc_callback', 'missing or invalid login transaction');
      return;
    }

    try {
      const currentUrl = new URL(req.url!, this.baseUrl);
      const tokenResponse = await oidc.authorizationCodeGrant(this.config, currentUrl, {
        pkceCodeVerifier: tx.codeVerifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
      });
      const claims = tokenResponse.claims();
      const user = {
        sub: claims?.sub ?? 'unknown',
        name: claims?.name as string | undefined,
        email: claims?.email as string | undefined,
      };

      const sessionId = this.sessionStore.create(user, tokenResponse.access_token, tokenResponse.refresh_token);

      this.clearTxCookie(res, req.headers.host, isSecureRequest(req));
      appendSetCookie(res, this.sessionCookie(sessionId, SESSION_TTL_MS, req.headers.host, isSecureRequest(req)));
      res.writeHead(302, { Location: tx.returnTo });
      res.end();
      log.info('oidc_login', 'user logged in', { sub: user.sub });
    } catch (err: any) {
      this.clearTxCookie(res, req.headers.host, isSecureRequest(req));
      log.error('oidc_callback', 'oidc callback error', { error: err.message });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Authentication failed');
    }
  }

  /** Local logout: destroy the Gateway session and clear the cookie. */
  logout(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) this.sessionStore.delete(sid);
    appendSetCookie(res, this.sessionCookie('', 0, req.headers.host, isSecureRequest(req)));
    res.writeHead(302, { Location: '/login' });
    res.end();
  }

  getSession(req: http.IncomingMessage): Session | undefined {
    const sid = parseCookies(req)[SESSION_COOKIE];
    return sid ? this.sessionStore.get(sid) : undefined;
  }

  getUser(req: http.IncomingMessage): { sub: string; name?: string; email?: string } | null {
    const s = this.getSession(req);
    return s ? s.user : null;
  }

  isConfigured(): boolean { return this.config !== null; }
  destroy(): void { this.sessionStore.destroy(); }

  // -- Cookie helpers --------------------------------------------------------

  private sessionCookie(value: string, maxAgeMs: number, hostHeader?: string, secure?: boolean): string {
    const domain = authCookieDomain(hostHeader, this.cookieDomain);
    const domainAttr = domain ? `; Domain=${domain}` : '';
    const maxAge = `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
    const secureAttr = secure ? '; Secure' : '';
    return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/${domainAttr}${maxAge}${secureAttr}`;
  }

  private setTxCookie(res: http.ServerResponse, tx: LoginTx, hostHeader?: string, secure?: boolean): void {
    const payload = Buffer.from(JSON.stringify(tx)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.txSecret).update(payload).digest('base64url');
    const domain = authCookieDomain(hostHeader, this.cookieDomain);
    const domainAttr = domain ? `; Domain=${domain}` : '';
    const secureAttr = secure ? '; Secure' : '';
    appendSetCookie(res, `${TX_COOKIE}=${payload}.${sig}; HttpOnly; SameSite=Lax; Path=/${domainAttr}${secureAttr}; Max-Age=${TX_TTL_MS / 1000}`);
  }

  private readTxCookie(req: http.IncomingMessage): LoginTx | undefined {
    const raw = parseCookies(req)[TX_COOKIE];
    if (!raw) return undefined;
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const payload = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = crypto.createHmac('sha256', this.txSecret).update(payload).digest('base64url');
    // constant-time comparison
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return undefined;
    try {
      const tx = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LoginTx;
      if (!tx || Date.now() > tx.expires) return undefined;
      return tx;
    } catch {
      return undefined;
    }
  }

  private clearTxCookie(res: http.ServerResponse, hostHeader?: string, secure?: boolean): void {
    const domain = authCookieDomain(hostHeader, this.cookieDomain);
    const domainAttr = domain ? `; Domain=${domain}` : '';
    const secureAttr = secure ? '; Secure' : '';
    appendSetCookie(res, `${TX_COOKIE}=; HttpOnly; SameSite=Lax; Path=/${domainAttr}${secureAttr}; Max-Age=0`);
  }
}

// -- Return-to URL sanitization -----------------------------------------------

/** Only allow same-origin relative paths or scheme-relative subdomain URLs as post-login redirect target. */
export function sanitizeReturnTo(returnTo: string, baseDomain: string): string {
  if (typeof returnTo !== 'string') return '/';

  // Same-origin relative path: /dashboard, /workspace/xxx
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) return returnTo;

  // Scheme-relative URL: //<host>/<path> — validate host is our baseDomain or a subdomain
  if (returnTo.startsWith('//')) {
    const hostEnd = returnTo.indexOf('/', 2);
    const host = (hostEnd > 0 ? returnTo.slice(2, hostEnd) : returnTo.slice(2)).replace(/:.*$/, '');
    if (!host) return '/';
    // Reject hosts with dangerous characters (prevents URL parsing tricks)
    if (/[@:]/.test(host)) return '/';
    // Must be baseDomain or a subdomain of baseDomain
    if (host === baseDomain || host.endsWith('.' + baseDomain)) {
      return returnTo;
    }
    return '/';
  }

  return '/';
}
