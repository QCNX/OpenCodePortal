import * as net from 'node:net';

/** Host routing: apex dashboard vs instance subdomain */
export type HostRoute = 'apex' | { subdomain: string };

/**
 * Parse the request Host header into apex or a single-level instance subdomain.
 * Missing Host (unit tests) is treated as apex.
 */
export function parseRequestHost(hostHeader: string | undefined, baseDomain: string): HostRoute | null {
  if (!hostHeader) return 'apex';

  const host = hostHeader.split(':')[0].toLowerCase();
  const base = baseDomain.toLowerCase();

  if (host === base) return 'apex';

  const suffix = `.${base}`;
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    if (label && !label.includes('.')) {
      return { subdomain: label };
    }
  }

  return null;
}

/** Detect if a Host header value is a raw IP address (IPv4 or IPv6). */
export function isIpHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let host = hostHeader;
  // IPv6 with brackets + optional port: "[::1]:8080" -> "::1"
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close > 1) host = host.slice(1, close);
  } else if (net.isIP(host) === 0) {
    // Bare IPv4 with optional port: "192.168.1.1:8080" -> "192.168.1.1"
    const colon = host.lastIndexOf(':');
    if (colon >= 0) host = host.slice(0, colon);
  }
  return net.isIP(host) !== 0;
}

/** Hostname without port (lowercased). */
export function hostWithoutPort(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  let host = hostHeader;
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close > 1) return host.slice(1, close).toLowerCase();
    return host.toLowerCase();
  }
  if (net.isIP(host) === 0) {
    const colon = host.lastIndexOf(':');
    if (colon >= 0) host = host.slice(0, colon);
  }
  return host.toLowerCase();
}

/** Detect if a Host header value is a loopback IP address for local dev. */
export function isLoopbackIpHost(hostHeader: string | undefined): boolean {
  const host = hostWithoutPort(hostHeader);
  if (!host) return false;
  let ip = host;
  if (ip === '::1') return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  return ip === '127.0.0.1';
}

/** `localhost` hostname — common when baseDomain is not localhost. */
export function isLocalDevHostname(hostHeader: string | undefined): boolean {
  return hostWithoutPort(hostHeader) === 'localhost';
}

/** RFC1918 / link-local IPv4 hosts for LAN dev (e.g. PVE bridge 10.x). */
export function isPrivateLanIpHost(hostHeader: string | undefined): boolean {
  const host = hostWithoutPort(hostHeader);
  if (net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Hosts that may reach apex Dashboard/API when they do not match baseDomain.
 * Loopback IP, localhost hostname, or private LAN IP — public IPs stay blocked.
 */
export function isDevApexHost(hostHeader: string | undefined): boolean {
  return isLoopbackIpHost(hostHeader)
    || isLocalDevHostname(hostHeader)
    || isPrivateLanIpHost(hostHeader);
}

/**
 * Set-Cookie Domain attribute for auth cookies. Returns null for host-only cookies
 * (dev apex hosts that do not match baseDomain, e.g. 127.0.0.1 vs portal.example.com).
 */
export function authCookieDomain(hostHeader: string | undefined, baseDomain: string): string | null {
  const host = hostWithoutPort(hostHeader);
  const base = baseDomain.toLowerCase();
  if (!host) return `.${base}`;
  if (host === base || host.endsWith(`.${base}`)) return `.${base}`;
  if (isDevApexHost(hostHeader)) return null;
  return `.${base}`;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return true; // unit-test IncomingMessage mocks do not carry a socket address
  if (address === '::1') return true;
  if (address.startsWith('::ffff:')) address = address.slice('::ffff:'.length);
  return address === '127.0.0.1';
}
