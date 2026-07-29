import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger';

const log = createLogger('gateway');

const FALLBACK_VERSION = '0.0.0';

let cachedVersion: string | undefined;

function packageJsonCandidates(): string[] {
  const candidates: string[] = [];
  // tsc → dist/shared/version.js; ../../package.json is project root in Docker WORKDIR /app
  if (typeof __dirname !== 'undefined') {
    candidates.push(join(__dirname, '../../package.json'));
  }
  candidates.push(join(process.cwd(), 'package.json'));
  return candidates;
}

export function getPortalVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;

  for (const candidate of packageJsonCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, 'utf8');
      const pkg = JSON.parse(raw) as { version?: unknown };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        cachedVersion = pkg.version;
        return cachedVersion;
      }
      log.warn('portal_version', 'package.json missing version field', { path: candidate });
    } catch (err) {
      log.warn('portal_version', 'failed to read package.json version', {
        path: candidate,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  cachedVersion = FALLBACK_VERSION;
  return cachedVersion;
}

export function formatPortalVersionLabel(version: string): string {
  return `v${version}`;
}
