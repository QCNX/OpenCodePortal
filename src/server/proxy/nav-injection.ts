import * as crypto from 'crypto';
import { patchCspInHtml } from './csp';
import { renderPortalNavScript, type PortalNavScriptInstance } from './nav-script';
import { headerToString } from '../../shared/http-headers';

function isUtf8Html(contentType: string | string[] | undefined): boolean {
  const ct = headerToString(contentType);
  const charsetMatch = /charset=([^\s;]+)/i.exec(ct);
  const encoding = charsetMatch ? charsetMatch[1].toLowerCase().replace(/['"]/g, '') : 'utf-8';
  return encoding === 'utf-8' || encoding === 'utf8';
}

export interface PortalNavInjectionModel {
  baseDomain: string;
  instanceId: string;
  authEnabled: boolean;
  instances: PortalNavScriptInstance[];
}

/**
 * Inject portal controls into proxied OpenCode HTML pages.
 * Returns injected HTML plus scriptHash for patchCspForScript().
 */
export function injectPortalNav(
  body: Buffer,
  model: PortalNavInjectionModel,
  contentType?: string | string[],
): { body: Buffer; scriptHash: string } {
  if (!isUtf8Html(contentType)) {
    return { body, scriptHash: '' };
  }

  // Instance list for client-side submenu — online first
  const sorted = [...model.instances].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const currentInstance = model.instances.find(i => i.id === model.instanceId);
  const currentSub = currentInstance?.id ?? '';

  const scriptBody = renderPortalNavScript({
    baseDomain: model.baseDomain,
    currentSub,
    authEnabled: model.authEnabled,
    instances: sorted.map(i => ({
      id: i.id,
      name: i.name,
      status: i.status,
    })),
  });

  // The CSP hash is over the exact bytes between <script> and </script>.
  const scriptHash = crypto.createHash('sha256').update(scriptBody, 'utf8').digest('base64');
  const navHtml = `\n<script>${scriptBody}</script>\n`;

  let bodyStr = body.toString('utf8');
  const closingBodyIdx = bodyStr.lastIndexOf('</body>');
  if (closingBodyIdx >= 0) {
    const before = bodyStr.substring(0, closingBodyIdx);
    const after = bodyStr.substring(closingBodyIdx);
    bodyStr = before + navHtml + after;
  } else {
    bodyStr = bodyStr + navHtml;
  }
  bodyStr = patchCspInHtml(bodyStr, scriptHash);
  return { body: Buffer.from(bodyStr, 'utf8'), scriptHash };
}
