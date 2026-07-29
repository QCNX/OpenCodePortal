import { describe, it, expect } from 'vitest';
import {
  parseRequestHost,
  isIpHost,
  isDevApexHost,
  isLocalDevHostname,
  isPrivateLanIpHost,
  authCookieDomain,
} from './host-routing';

const BASE_DOMAIN = 'localhost';

describe('parseRequestHost', () => {
  it('returns apex for base domain', () => {
    expect(parseRequestHost('localhost', BASE_DOMAIN)).toBe('apex');
    expect(parseRequestHost('localhost:8080', BASE_DOMAIN)).toBe('apex');
  });

  it('returns subdomain for instance host', () => {
    expect(parseRequestHost('vm-online.localhost', BASE_DOMAIN)).toEqual({ subdomain: 'vm-online' });
  });

  it('returns null for unknown host', () => {
    expect(parseRequestHost('evil.example.com', BASE_DOMAIN)).toBeNull();
  });
});

describe('isIpHost', () => {
  it('returns true for IPv4', () => {
    expect(isIpHost('192.168.1.1')).toBe(true);
    expect(isIpHost('127.0.0.1:8080')).toBe(true);
    expect(isIpHost('10.0.0.1')).toBe(true);
  });

  it('returns true for IPv6', () => {
    expect(isIpHost('::1')).toBe(true);
    expect(isIpHost('[::1]:8080')).toBe(true);
    expect(isIpHost('fe80::1')).toBe(true);
  });

  it('returns false for domain names', () => {
    expect(isIpHost('localhost')).toBe(false);
    expect(isIpHost('example.com')).toBe(false);
    expect(isIpHost('vm.localhost')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isIpHost(undefined)).toBe(false);
  });
});

describe('dev apex hosts', () => {
  it('accepts localhost hostname and loopback IPs', () => {
    expect(isLocalDevHostname('localhost')).toBe(true);
    expect(isLocalDevHostname('localhost:8080')).toBe(true);
    expect(isDevApexHost('127.0.0.1:8080')).toBe(true);
    expect(isDevApexHost('::1')).toBe(true);
    expect(isDevApexHost('localhost:8080')).toBe(true);
  });

  it('accepts private LAN IPs', () => {
    expect(isPrivateLanIpHost('10.1.0.25:8080')).toBe(true);
    expect(isPrivateLanIpHost('192.168.1.1')).toBe(true);
    expect(isDevApexHost('10.1.0.25')).toBe(true);
  });

  it('rejects public IPs and unrelated domains', () => {
    expect(isDevApexHost('8.8.8.8')).toBe(false);
    expect(isDevApexHost('evil.example.com')).toBe(false);
  });
});

describe('authCookieDomain', () => {
  it('uses baseDomain for matching hosts', () => {
    expect(authCookieDomain('portal.example.com', 'portal.example.com')).toBe('.portal.example.com');
    expect(authCookieDomain('dev.portal.example.com', 'portal.example.com')).toBe('.portal.example.com');
    expect(authCookieDomain('localhost', 'localhost')).toBe('.localhost');
  });

  it('returns null for dev apex hosts that do not match baseDomain', () => {
    expect(authCookieDomain('127.0.0.1:8080', 'portal.example.com')).toBeNull();
    expect(authCookieDomain('localhost:8080', 'portal.example.com')).toBeNull();
    expect(authCookieDomain('10.1.0.25', 'portal.example.com')).toBeNull();
  });
});
