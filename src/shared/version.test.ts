import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { formatPortalVersionLabel, getPortalVersion } from './version';

describe('portal version', () => {
  it('reads version from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(getPortalVersion()).toBe(pkg.version);
  });

  it('formats version label with v prefix', () => {
    expect(formatPortalVersionLabel('0.2.1')).toBe('v0.2.1');
  });
});
