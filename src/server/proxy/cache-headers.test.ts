import { describe, it, expect } from 'vitest';
import { overrideCacheHeaders } from './cache-headers';

describe('overrideCacheHeaders', () => {
  it('sets no-cache directives', () => {
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    overrideCacheHeaders(headers);
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['pragma']).toBe('no-cache');
  });

  it('replaces upstream cacheable directives', () => {
    const headers: Record<string, string> = {
      'cache-control': 'public, max-age=31536000, immutable',
      expires: 'Wed, 21 Oct 2099 07:28:00 GMT',
      pragma: 'cache',
    };
    overrideCacheHeaders(headers);
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['expires']).toBeUndefined();
    expect(headers['pragma']).toBe('no-cache');
  });

  it('preserves validators for cheap 304 revalidation', () => {
    const headers: Record<string, string> = {
      etag: '"abc123"',
      'last-modified': 'Wed, 21 Oct 2020 07:28:00 GMT',
      'content-type': 'application/javascript',
    };
    overrideCacheHeaders(headers);
    expect(headers['etag']).toBe('"abc123"');
    expect(headers['last-modified']).toBe('Wed, 21 Oct 2020 07:28:00 GMT');
    expect(headers['cache-control']).toBe('no-cache');
  });
});
