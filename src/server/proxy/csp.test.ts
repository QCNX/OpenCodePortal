import { describe, it, expect } from 'vitest';
import { patchCspForScript, patchCspInHtml } from './csp';

describe('patchCspForScript', () => {
  it('appends sha256 token to existing script-src directive', () => {
    const headers: Record<string, string> = {
      'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-abc='",
    };
    patchCspForScript(headers, 'MYHASH=');
    expect(headers['content-security-policy']).toContain("'sha256-MYHASH='");
    expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
    expect(headers['content-security-policy']).toContain("'sha256-abc='");
    const scriptSrc = headers['content-security-policy']
      .split(';')
      .find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).toContain("'sha256-MYHASH='");
  });

  it('falls back to default-src when no script-src directive exists', () => {
    const headers: Record<string, string> = {
      'content-security-policy': "default-src 'self' 'sha256-abc='",
    };
    patchCspForScript(headers, 'MYHASH=');
    expect(headers['content-security-policy']).toContain("'sha256-MYHASH='");
  });

  it('is a no-op when no CSP header is present', () => {
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    patchCspForScript(headers, 'MYHASH=');
    expect(headers['content-security-policy']).toBeUndefined();
  });

  it('does not duplicate the token when already present', () => {
    const headers: Record<string, string> = {
      'content-security-policy': "script-src 'self' 'sha256-MYHASH='",
    };
    patchCspForScript(headers, 'MYHASH=');
    const occurrences = headers['content-security-policy'].split("'sha256-MYHASH='").length - 1;
    expect(occurrences).toBe(1);
  });

  it('patches both script-src and script-src-elem when both are present', () => {
    const headers: Record<string, string> = {
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-abc='; script-src-elem 'self' 'wasm-unsafe-eval'",
    };
    patchCspForScript(headers, 'MYHASH=');
    const csp = headers['content-security-policy'];
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src '))!;
    const scriptSrcElem = csp.split(';').find((d) => d.trim().startsWith('script-src-elem'))!;
    expect(scriptSrc).toContain("'sha256-MYHASH='");
    expect(scriptSrcElem).toContain("'sha256-MYHASH='");
  });

  it('patches content-security-policy-report-only header', () => {
    const headers: Record<string, string> = {
      'content-security-policy-report-only': "script-src 'self'",
    };
    patchCspForScript(headers, 'MYHASH=');
    expect(headers['content-security-policy-report-only']).toContain("'sha256-MYHASH='");
  });

  it('patches enforcing and report-only CSP headers when both are present', () => {
    const headers: Record<string, string> = {
      'content-security-policy-report-only': "script-src 'self'",
      'content-security-policy': "script-src 'self'",
    };
    patchCspForScript(headers, 'MYHASH=');
    expect(headers['content-security-policy-report-only']).toContain("'sha256-MYHASH='");
    expect(headers['content-security-policy']).toContain("'sha256-MYHASH='");
  });
});

describe('patchCspInHtml', () => {
  it('patches meta Content-Security-Policy content attribute', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'wasm-unsafe-eval\'"></head><body></body></html>';
    const out = patchCspInHtml(html, 'MYHASH=');
    expect(out).toContain("'sha256-MYHASH='");
    expect(out).toContain("'wasm-unsafe-eval'");
  });
});
