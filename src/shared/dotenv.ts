// ---------------------------------------------------------------------------
// Minimal .env loader — no external dependency.
// Loads KEY=VALUE pairs into process.env (does not override existing env).
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

/**
 * Load a dotenv file into `process.env`.
 * @returns true if the file existed and was parsed.
 */
export function loadDotEnv(filePath = path.join(process.cwd(), '.env')): boolean {
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}
