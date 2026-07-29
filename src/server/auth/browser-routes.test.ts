import { describe, it, expect } from 'vitest';
import { BrowserAuthRoutes } from './browser-routes';
import { AuthGate } from './gate';
import { OidcClient } from './oidc-client';
import { createMockReq, createMockReqWithBody, createMockRes } from '../test-helpers';

const SECRET = 'secret123';

function loginPost(secret: string, ip = '10.0.0.1', extraBody = '') {
  let body = `secret=${encodeURIComponent(secret)}`;
  if (extraBody) body += '&' + extraBody;
  const req = createMockReqWithBody('/login', 'POST', body, {
    'x-forwarded-for': ip,
    'accept-language': 'en',
  });
  (req as any).socket = { remoteAddress: ip };
  return { req, res: createMockRes() };
}

describe('BrowserAuthRoutes login rate limit', () => {
  it('blocks POST /login after repeated failures from the same IP', async () => {
    const routes = new BrowserAuthRoutes(new AuthGate(SECRET, 'localhost'));

    for (let i = 0; i < 10; i++) {
      const { req, res } = loginPost('wrong');
      await routes.handle(req, res, '/login', 'POST', Date.now());
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Invalid secret');
    }

    const { req, res } = loginPost('wrong');
    await routes.handle(req, res, '/login', 'POST', Date.now());
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Too many login attempts');
    expect(res.body).not.toContain('Invalid secret, try again');
  });

  it('clears failure counter after successful login', async () => {
    const routes = new BrowserAuthRoutes(new AuthGate(SECRET, 'localhost'));

    for (let i = 0; i < 5; i++) {
      const { req, res } = loginPost('wrong', '10.0.0.2');
      await routes.handle(req, res, '/login', 'POST', Date.now());
    }

    const ok = loginPost(SECRET, '10.0.0.2');
    await routes.handle(ok.req, ok.res, '/login', 'POST', Date.now());
    expect(ok.res.statusCode).toBe(302);

    for (let i = 0; i < 10; i++) {
      const { req, res } = loginPost('wrong', '10.0.0.2');
      await routes.handle(req, res, '/login', 'POST', Date.now());
      expect(res.body).toContain('Invalid secret');
    }
  });
});

describe('BrowserAuthRoutes returnTo on login', () => {
  it('sharedSecret POST redirects to sanitized return URL from form body', async () => {
    const routes = new BrowserAuthRoutes(new AuthGate(SECRET, 'example.com'));
    const { req, res } = loginPost(SECRET, '10.0.0.1', 'return=%2F%2Fdev.example.com%2Fworkspace');
    await routes.handle(req, res, '/login', 'POST', Date.now());
    expect(res.statusCode).toBe(302);
    expect(res.headers['Location'] || res.headers['location']).toBe('//dev.example.com/workspace');
  });

  it('sharedSecret POST redirects to / when no return param', async () => {
    const routes = new BrowserAuthRoutes(new AuthGate(SECRET, 'example.com'));
    const { req, res } = loginPost(SECRET, '10.0.0.1');
    await routes.handle(req, res, '/login', 'POST', Date.now());
    expect(res.statusCode).toBe(302);
    expect(res.headers['Location'] || res.headers['location']).toBe('/');
  });

  it('sharedSecret POST rejects malicious return URL (open redirect prevention)', async () => {
    const routes = new BrowserAuthRoutes(new AuthGate(SECRET, 'example.com'));
    const { req, res } = loginPost(SECRET, '10.0.0.1', 'return=%2F%2Fevil.com%2Fphish');
    await routes.handle(req, res, '/login', 'POST', Date.now());
    expect(res.statusCode).toBe(302);
    expect(res.headers['Location'] || res.headers['location']).toBe('/');
  });

  it('/auth/login passes return query param to OidcClient.login', async () => {
    const gate = new AuthGate(undefined, 'example.com');
    const oidc = new OidcClient();
    let capturedReturnTo: string | undefined;
    (oidc as any).login = (_req: any, _res: any, returnTo?: string) => {
      capturedReturnTo = returnTo;
      _res.writeHead(302, { Location: 'https://idp.example.com/auth' });
      _res.end();
      return Promise.resolve();
    };
    (oidc as any).isConfigured = () => true;
    gate.setOidcClient(oidc);
    const routes = new BrowserAuthRoutes(gate);

    const req = createMockReq('/auth/login?return=%2F%2Fdev.example.com%2Fworkspace', 'GET', {
      host: 'example.com',
    });
    const res = createMockRes();
    await routes.handle(req, res, '/auth/login', 'GET', Date.now());
    expect(res.statusCode).toBe(302);
    expect(capturedReturnTo).toBe('//dev.example.com/workspace');
  });
});
