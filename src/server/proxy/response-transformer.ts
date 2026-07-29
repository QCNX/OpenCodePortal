import { injectPortalNav } from './nav-injection';
import { patchCspForScript } from './csp';
import { overrideCacheHeaders } from './cache-headers';
import { headerToString } from '../../shared/http-headers';

export interface PortalNavInstance {
  id: string;
  name: string;
  status: string;
}

export interface ResponseTransformerDeps {
  baseDomain: string;
  authEnabled(): boolean;
  listInstances(): PortalNavInstance[];
}

export interface IResponseTransformer {
  transformHtmlResponse(
    headers: Record<string, string | string[]>,
    body: Buffer,
    instanceId: string,
  ): { body: Buffer; headers: Record<string, string | string[]> };
}

export class DefaultResponseTransformer implements IResponseTransformer {
  constructor(private deps: ResponseTransformerDeps) {}

  transformHtmlResponse(
    headers: Record<string, string | string[]>,
    body: Buffer,
    instanceId: string,
  ): { body: Buffer; headers: Record<string, string | string[]> } {
    const nextHeaders = { ...headers };
    if (!headerToString(nextHeaders['content-type']).includes('charset')) {
      nextHeaders['content-type'] = 'text/html; charset=utf-8';
    }

    const injected = injectPortalNav(body, {
      baseDomain: this.deps.baseDomain,
      instanceId,
      authEnabled: this.deps.authEnabled(),
      instances: this.deps.listInstances(),
    }, nextHeaders['content-type']);

    let nextBody = injected.body;
    patchCspForScript(nextHeaders, injected.scriptHash);
    if (nextHeaders['content-length']) {
      nextHeaders['content-length'] = String(nextBody.length);
    }

    overrideCacheHeaders(nextHeaders);
    return { body: nextBody, headers: nextHeaders };
  }
}
