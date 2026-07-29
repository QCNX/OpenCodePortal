// ---------------------------------------------------------------------------
// Tests: shared/dotenv.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotEnv } from './dotenv';

describe('loadDotEnv', () => {
  let tmpDir: string;
  let envPath: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-dotenv-'));
    envPath = path.join(tmpDir, '.env');
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function stash(key: string): void {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  it('returns false when the file is missing', () => {
    expect(loadDotEnv(path.join(tmpDir, 'missing.env'))).toBe(false);
  });

  it('loads unquoted values and skips comments / blanks', () => {
    stash('OIDC_CLIENT_ID');
    stash('OIDC_CLIENT_SECRET');
    fs.writeFileSync(envPath, `
# comment
OIDC_CLIENT_ID=my-client

OIDC_CLIENT_SECRET=shh-secret
`);
    expect(loadDotEnv(envPath)).toBe(true);
    expect(process.env.OIDC_CLIENT_ID).toBe('my-client');
    expect(process.env.OIDC_CLIENT_SECRET).toBe('shh-secret');
  });

  it('strips surrounding quotes', () => {
    stash('QUOTED');
    fs.writeFileSync(envPath, 'QUOTED="hello world"\n');
    loadDotEnv(envPath);
    expect(process.env.QUOTED).toBe('hello world');
  });

  it('does not override variables already in the environment', () => {
    stash('OIDC_CLIENT_ID');
    process.env.OIDC_CLIENT_ID = 'from-shell';
    fs.writeFileSync(envPath, 'OIDC_CLIENT_ID=from-file\n');
    loadDotEnv(envPath);
    expect(process.env.OIDC_CLIENT_ID).toBe('from-shell');
  });
});
