/**
 * Append an injected inline script's sha256 hash to a CSP policy string.
 * Patches every script-src and script-src-elem directive. Falls back to
 * default-src when no script directive exists.
 */
export function patchCspPolicyString(policy: string, scriptHash: string): string {
  const token = `'sha256-${scriptHash}'`;
  const directives = policy.split(';');
  let hasScriptDirective = false;
  for (let i = 0; i < directives.length; i++) {
    const name = directives[i].trim().split(/\s+/)[0]?.toLowerCase();
    if (name === 'script-src' || name === 'script-src-elem') {
      hasScriptDirective = true;
      if (!directives[i].includes(token)) {
        directives[i] = `${directives[i].trimEnd()} ${token}`;
      }
    }
  }
  if (!hasScriptDirective) {
    for (let i = 0; i < directives.length; i++) {
      const name = directives[i].trim().split(/\s+/)[0]?.toLowerCase();
      if (name === 'default-src') {
        if (!directives[i].includes(token)) {
          directives[i] = `${directives[i].trimEnd()} ${token}`;
        }
        break;
      }
    }
  }
  return directives.join(';');
}

export function patchCspForScript(headers: Record<string, string | string[]>, scriptHash: string): void {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower !== 'content-security-policy' && lower !== 'content-security-policy-report-only') continue;
    const value = headers[key];
    headers[key] = Array.isArray(value)
      ? value.map((policy) => patchCspPolicyString(policy, scriptHash))
      : patchCspPolicyString(value, scriptHash);
  }
}

export function patchCspInHtml(body: string, scriptHash: string): string {
  return body.replace(
    /<meta\s+([^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*)>/gi,
    (match, attrs) => {
      const contentMatch = attrs.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
      if (!contentMatch) return match;
      const quote = contentMatch[1][0];
      const content = contentMatch[2] ?? contentMatch[3];
      const patched = patchCspPolicyString(content, scriptHash);
      const newAttrs = attrs.replace(contentMatch[0], `content=${quote}${patched}${quote}`);
      return `<meta ${newAttrs}>`;
    },
  );
}
