// ---------------------------------------------------------------------------
// Agent — OpenCode version probe
// ---------------------------------------------------------------------------
//
// Probes the local OpenCode Server's /global/health endpoint to discover
// the upstream version. Called once after successful registration, then
// periodically retried on failure (hourly).
// ---------------------------------------------------------------------------

import * as http from 'http';

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Probe the local OpenCode server for its version by requesting /global/health.
 * Returns the version string on success, undefined on any failure.
 */
export function probeOpencodeVersion(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        method: 'GET',
        path: '/global/health',
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(undefined);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const version = body?.version;
            if (typeof version === 'string' && version.length > 0) {
              resolve(version);
            } else {
              resolve(undefined);
            }
          } catch {
            resolve(undefined);
          }
        });
        res.on('error', () => resolve(undefined));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
    req.on('error', () => resolve(undefined));
    req.end();
  });
}
