import * as http from 'http';
import { InstanceRegistry } from './registry';
import { MemoryStateStore } from '../shared/state';

export const BASE_DOMAIN = 'localhost';
export const APEX_HOST = { host: 'localhost' };
export const instanceHost = (subdomain: string) => ({ host: `${subdomain}.${BASE_DOMAIN}` });

export function createMockRes(): any {
  const self: any = {
    statusCode: 0,
    statusMessage: '',
    headers: {} as Record<string, any>,
    body: '',
    headersSent: false,
    _headers: {} as Record<string, any>,
    _closeCallbacks: [] as Function[],

    writeHead(statusCode: number, arg2?: any, arg3?: any) {
      self.statusCode = statusCode;
      if (typeof arg2 === 'string') {
        self.statusMessage = arg2;
        self.headers = { ...self._headers, ...(arg3 || {}) };
      } else {
        self.headers = { ...self._headers, ...(arg2 || {}) };
      }
      self.headersSent = true;
      return self;
    },

    end(data?: string) {
      self.body = data || '';
      return self;
    },

    getHeader(name: string) {
      return self._headers[name.toLowerCase()];
    },

    setHeader(name: string, value: any) {
      self._headers[name.toLowerCase()] = value;
    },

    once(event: string, cb: Function) {
      if (event === 'close') {
        self._closeCallbacks.push(cb);
      }
      return self;
    },
  };
  return self;
}

export function createMockReq(
  url: string,
  method = 'GET',
  headers: Record<string, string | string[]> = {},
): http.IncomingMessage {
  const req = new http.IncomingMessage({} as any);
  req.url = url;
  req.method = method;
  req.headers = headers;
  return req;
}

export function createMockReqWithBody(
  url: string,
  method: string,
  body: string,
  headers: Record<string, string | string[]> = {},
): http.IncomingMessage {
  const req = new http.IncomingMessage({} as any);
  req.url = url;
  req.method = method;
  req.headers = { ...headers, 'content-type': 'application/json' };
  setTimeout(() => {
    req.emit('data', Buffer.from(body));
    req.emit('end');
  }, 1);
  return req;
}

export function createFakeOidc(session?: { sub: string; name?: string; email?: string }): any {
  return {
    sessionValue: session,
    calls: { login: 0, callback: 0, logout: 0 },
    getSession() { return this.sessionValue; },
    getUser() { return this.sessionValue ?? null; },
    isConfigured() { return true; },
    login(_req: any, res: any) {
      this.calls.login++;
      res.writeHead(302, { Location: 'https://idp.example.com/authorize' });
      res.end();
      return Promise.resolve();
    },
    handleCallback(_req: any, res: any) {
      this.calls.callback++;
      res.writeHead(302, { Location: '/' });
      res.end();
      return Promise.resolve();
    },
    logout(_req: any, res: any) {
      this.calls.logout++;
      res.writeHead(302, { Location: '/' });
      res.end();
    },
  };
}

export function createMockSocket(): any {
  return {
    written: '' as string,
    destroyed: false,
    write(data: string) { this.written += data; return true; },
    destroy() { this.destroyed = true; },
  };
}

export function createHydratedRegistry(
  defs: { id: string; name: string; tags: string[] }[],
): InstanceRegistry {
  const registry = new InstanceRegistry();
  const store = new MemoryStateStore();
  registry.hydrate(store);
  for (const def of defs) {
    registry.create(def.id, def.name, def.tags);
  }
  return registry;
}
