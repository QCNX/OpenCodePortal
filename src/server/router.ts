// ---------------------------------------------------------------------------
// Gateway — HTTP router
// ---------------------------------------------------------------------------
//
// Handles browser HTTP requests (Host-based routing):
//   Host == baseDomain (apex) or raw IP:
//     GET  /, /dashboard    → Dashboard
//     GET  /health          → Health JSON (public)
//     GET  /login           → Login form (public)
//     POST /login           → Authenticate via sharedSecret → SSO cookie on .baseDomain
//     GET  /events          → Dashboard SSE
//     GET  /auth/*          → OIDC (Phase 2)
//   Host == <sub>.baseDomain:
//     ALL  /*               → Proxy to Agent → OpenCode (path forwarded as-is)
// ---------------------------------------------------------------------------

import * as http from 'http';
import { Duplex } from 'stream';
import { InstanceRegistry } from './registry';
import type { AgentTransport } from './agent-transport';
import { isChannelRequestId } from '../shared/protocol';
import { createLogger, Logger } from '../shared/logger';
import type { ChannelOpenedMessage, ChannelErrorMessage, ChannelClosedMessage } from '../shared/types';
import type { OidcClient } from './auth/oidc-client';
import { parseRequestHost, isDevApexHost } from './http/host-routing';
import { isSecureRequest } from './http/cookies';
import { handleHealthRoute, handlePortalStaticRoute } from './http/static-routes';
import { BrowserAuthRoutes } from './auth/browser-routes';
import { DefaultResponseTransformer } from './proxy/response-transformer';
import { loadSetupGuideContent, type SetupGuideContent } from './setup-guide/loader';
import { InstancesApi } from './api/instances-api';
import { toInstanceView } from './api/instance-view';
import { detectPortalLocale } from './i18n';
import { AuthGate } from './auth/gate';
import { ProxyRequestState } from './proxy/request-state';
import { handleSubdomainProxyRoute } from './proxy/subdomain-route';
import { handleAgentHttpResponse } from './proxy/agent-http-response';
import { AgentRequestProxy } from './proxy/request-forwarder';
import { BrowserWsChannels } from './proxy/browser-ws-channels';
import { renderDashboardPage } from './webui/dashboard-page';
import { DashboardEventBus } from './webui/dashboard-event-bus';

const log: Logger = createLogger('gateway');

export class Router {
  readonly proxyState = new ProxyRequestState();
  private transport: AgentTransport | null = null;
  private sharedSecret: string | undefined;
  private oidcClient: OidcClient | null = null;
  private authGate: AuthGate;
  private instancesApi: InstancesApi;
  private browserAuthRoutes: BrowserAuthRoutes;
  private requestProxy: AgentRequestProxy;
  private browserWsChannels: BrowserWsChannels;
  private responseTransformer: DefaultResponseTransformer;
  private setupGuide: SetupGuideContent | null = null;
  private dashboardBus: DashboardEventBus | undefined;

  constructor(
    private registry: InstanceRegistry,
    sharedSecret?: string,
    private baseDomain: string = 'localhost',
    private gwPort: number = 8080,
    cookieSecret?: string,
    private agentImage: string = 'ghcr.io/qcnx/opencode-portal-agent:latest',
  ) {
    this.sharedSecret = sharedSecret;
    this.authGate = new AuthGate(sharedSecret, baseDomain, cookieSecret);
    this.instancesApi = new InstancesApi({
      registry,
      baseDomain,
      agentImage,
      isAuthenticated: (req) => this.isAuthenticated(req),
    });
    this.browserAuthRoutes = new BrowserAuthRoutes(this.authGate);
    this.requestProxy = new AgentRequestProxy({
      registry,
      getTransport: () => this.transport,
      state: this.proxyState,
    });
    this.responseTransformer = new DefaultResponseTransformer({
      baseDomain,
      authEnabled: () => this.authEnabled,
      listInstances: () => this.registry.list().map(i => ({
        id: i.id,
        name: i.name,
        status: i.status,
      })),
    });
    this.browserWsChannels = new BrowserWsChannels({
      registry,
      baseDomain,
      getTransport: () => this.transport,
      authGate: this.authGate,
    });
    // Load setup guide content from docs/setup-guide/ (relative to cwd).
    // Non-fatal: if files are missing the Setup Guide button won't appear.
    this.setupGuide = loadSetupGuideContent(`${process.cwd()}/docs`);
    if (!this.setupGuide) {
      log.warn('setup_guide_missing', 'setup guide files not found, button will be hidden');
    }
  }

  setTransport(transport: AgentTransport): void {
    this.transport = transport;
  }

  setOidcClient(client: OidcClient): void {
    this.oidcClient = client;
    this.authGate.setOidcClient(client);
  }

  /** Wire the Dashboard SSE event bus (created by the entry point). */
  setDashboardBus(bus: DashboardEventBus): void {
    this.dashboardBus = bus;
  }

  // -- Registry helpers -------------------------------------------------------

  /** Enrich an Instance with target host/port and auth fields from registry. */
  private enrichInstance(inst: { id: string; name: string; tags: string[]; status: string; sessionCount: number; lastSeen: number; connectedAt: number }) {
    return toInstanceView(this.registry, inst);
  }

  // -- Auth ------------------------------------------------------------------

  /**
   * OIDC SSO is active iff an OidcClient was wired in. In this mode the
   * sharedSecret login form + ocp_auth cookie are masked; Bearer / ?token=
   * remain available as a break-glass / API path.
   */
  private get oidcMode(): boolean {
    return this.authGate.oidcMode;
  }

  /** True when any auth is enforced (OIDC or sharedSecret). */
  private get authEnabled(): boolean {
    return this.authGate.authEnabled;
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    return this.authGate.checkBearerOrToken(req);
  }

  private checkAuthCookie(req: http.IncomingMessage): boolean {
    return this.authGate.checkAuthCookie(req);
  }

  /** Returns true if the request passes the active auth mode's checks. */
  private isAuthenticated(req: http.IncomingMessage): boolean {
    return this.authGate.isAuthenticated(req);
  }

  // -- Request handlers ------------------------------------------------------

  /**
   * Handle an incoming HTTP request.
   */
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this._handleRequest(req, res).catch((err) => {
      log.error('http_error', 'unhandled request error', { error: String(err), stack: (err as Error).stack });
      if (!res.writableEnded) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
  }

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reqStart = Date.now();
    const method = req.method || '?';
    const url = req.url || '/';
    const path = url.split('?')[0] || '';

    // --- Public routes (no auth required) ---

    if (handleHealthRoute(url, res, this.registry, reqStart)) {
      return;
    }

    // Silently refresh a stale OIDC access token before any auth decision. On
    // IdP-side revocation the refresh is rejected and the local session is
    // dropped here, so the user lands on /login instead of riding a dead session.
    // The sync `needsRefresh` gate keeps the common fresh-token path await-free.
    if (this.oidcMode && this.oidcClient && this.oidcClient.needsRefresh(req)) {
      await this.oidcClient.refreshSessionIfStale(req);
    }

    const hostRoute = parseRequestHost(req.headers.host, this.baseDomain);
    const devApexHost = hostRoute === null && isDevApexHost(req.headers.host);

    if (hostRoute === null && !devApexHost) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      log.info('route_not_found', 'unknown host', { method, url, host: req.headers.host, duration_ms: Date.now() - reqStart });
      return;
    }

    // Instance subdomains are a separate origin boundary: every path is proxied
    // to OpenCode, including /api/* and /login. Gateway management routes only
    // live on the apex host.
    if (handleSubdomainProxyRoute({
      req,
      res,
      method,
      url,
      hostRoute,
      reqStart,
      registry: this.registry,
      authGate: this.authGate,
      proxyToAgent: (request, response, instanceId, pathToProxy) => {
        this.requestProxy.proxyToAgent(request, response, instanceId, pathToProxy);
      },
    })) {
      return;
    }

    // -- Instance CRUD API (ADR 0001 decision 3) --
    if (path.startsWith('/api/instances')
      && await this.instancesApi.handle(req, res, path, method)) {
      return;
    }

    // Portal static assets (public, no auth required, cacheable)
    if (handlePortalStaticRoute(path, url, res, reqStart)) {
      return;
    }

    if ((path === '/login' || path.startsWith('/auth/'))
      && await this.browserAuthRoutes.handle(req, res, path, method, reqStart)) {
      return;
    }

    // --- Auth required ---

    if (this.authGate.respondIfUnauthenticated(req, res, {
      isSubdomain: false,
      reqStart,
      method,
      url,
    })) {
      return;
    }

    // After successful sharedSecret auth via Bearer / ?token=, issue the
    // ocp_auth cookie — but only in sharedSecret mode. In OIDC mode the cookie
    // mechanism is masked (sessions are the source of truth).
    if (!this.oidcMode && this.sharedSecret && this.checkAuth(req) && !this.checkAuthCookie(req)) {
      log.info('cookie_auth_set', 'auth cookie issued', { method: 'Bearer/token' });
      this.authGate.setAuthCookie(res, req.headers.host, isSecureRequest(req));
    }

    // --- Apex: Dashboard & portal routes ---

    if (path === '/dashboard' || path === '/') {
      this.serveDashboard(req, res);
      log.info('http_response', 'dashboard served', { status: 200, duration_ms: Date.now() - reqStart });
      return;
    }

    if (url === '/events' && this.dashboardBus) {
      // Dashboard live updates are served by the injected event bus (wired
      // in index.ts); without one, the request falls through to the apex 404.
      this.dashboardBus.subscribe(res);
      return;
    }

    // 404 on apex for unmapped paths
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    log.info('route_not_found', 'no route matched', { method, url, duration_ms: Date.now() - reqStart });
  }

  /** Handle binary data from Agent (response to a forwarded request OR WS channel data). */
  handleAgentData(instanceId: string, requestId: number, payload: Buffer): void {
    // Explicit dispatch by ID namespace: channel IDs carry WS channel data,
    // HTTP IDs carry HTTP/SSE proxy responses.
    if (isChannelRequestId(requestId)) {
      this.browserWsChannels.forwardAgentData(requestId, payload);
      return;
    }

    if (handleAgentHttpResponse({
      instanceId,
      requestId,
      payload,
      state: this.proxyState,
      transformer: this.responseTransformer,
    })) {
      return;
    }

    // No matching request or channel — might be from a timed-out request
  }

  /**
   * Handle a browser WebSocket upgrade request.
   * Routes by Host subdomain to the matching instance.
   */
  handleWsUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    this.browserWsChannels.handleWsUpgrade(req, socket, head);
  }

  /** Handle channel control events from Agent. */
  handleAgentChannelEvent(
    _instanceId: string,
    msg: ChannelOpenedMessage | ChannelErrorMessage | ChannelClosedMessage,
  ): void {
    this.browserWsChannels.handleAgentChannelEvent(msg);
  }

  /** Clean up all WS channels for a disconnected agent. */
  cleanupInstanceChannels(instanceId: string): void {
    this.browserWsChannels.cleanupInstanceChannels(instanceId);
  }

  /** Clean up all pending/streaming HTTP requests for a disconnected agent. */
  cleanupInstanceRequests(instanceId: string): void {
    this.proxyState.cancelForInstance(instanceId, log);
  }

  // -- Dashboard -------------------------------------------------------------

  private serveDashboard(req: http.IncomingMessage, res: http.ServerResponse): void {
    const locale = detectPortalLocale(req);
    const instances = this.registry.list().map(i => this.enrichInstance(i));
    const html = renderDashboardPage({
      locale,
      instances,
      baseDomain: this.baseDomain,
      authEnabled: this.authEnabled,
      setupGuide: this.setupGuide,
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

}
