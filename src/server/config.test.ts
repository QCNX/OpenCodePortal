// ---------------------------------------------------------------------------
// Tests: server/config.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from './config';

describe('server/loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', () => {
    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.port).toBe(8080);
    expect(config.gateway.host).toBe('0.0.0.0');
    expect(config.gateway.baseDomain).toBe('localhost');
  });

  it('returns defaults when no path given and no config.yaml in CWD', () => {
    // Use a temp directory as CWD-relative path to avoid picking up project's config.yaml
    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.port).toBe(8080);
  });

  it('loads gateway settings from YAML file', () => {
    const yaml = `
gateway:
  port: 9090
  host: "127.0.0.1"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.port).toBe(9090);
    expect(config.gateway.host).toBe('127.0.0.1');
  });

  it('loads baseDomain from gateway config', () => {
    const yaml = `
gateway:
  baseDomain: "portal.example.com"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.baseDomain).toBe('portal.example.com');
  });

  it('uses configured Agent image for deploy instructions', () => {
    const yaml = `
gateway:
  agentImage: "registry.example.com/team/agent:v1"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.agentImage).toBe('registry.example.com/team/agent:v1');
  });

  it('allows OCP_AGENT_IMAGE to override the public default', () => {
    process.env.OCP_AGENT_IMAGE = 'registry.example.com/team/agent:v2';
    try {
      const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
      expect(config.gateway.agentImage).toBe('registry.example.com/team/agent:v2');
    } finally {
      delete process.env.OCP_AGENT_IMAGE;
    }
  });

  it('substitutes ${ENV_VAR} in YAML values', () => {
    process.env.TEST_PORT = '7777';
    process.env.TEST_BASE_DOMAIN = 'env.example.com';
    try {
      const yaml = `
gateway:
  port: \${TEST_PORT}
  baseDomain: "\${TEST_BASE_DOMAIN}"
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, yaml);

      const config = loadConfig(configPath);
      expect(config.gateway.port).toBe(7777);
      expect(config.gateway.baseDomain).toBe('env.example.com');
    } finally {
      delete process.env.TEST_PORT;
      delete process.env.TEST_BASE_DOMAIN;
    }
  });

  it('keeps ${VAR} literal if env var is not set', () => {
    delete process.env.NONEXISTENT_VAR;
    const yaml = `
gateway:
  baseDomain: "\${NONEXISTENT_VAR}"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.baseDomain).toBe('${NONEXISTENT_VAR}');
  });

  it('merges partial config with defaults', () => {
    const yaml = `
gateway:
  port: 3000
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.port).toBe(3000);
    expect(config.gateway.host).toBe('0.0.0.0');    // default
    expect(config.gateway.baseDomain).toBe('localhost'); // default
  });

  it('loads sharedSecret from config', () => {
    const yaml = `
gateway:
  sharedSecret: "ocp-sk-my-secret"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.sharedSecret).toBe('ocp-sk-my-secret');
  });

  it('sharedSecret defaults to undefined when not configured', () => {
    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.sharedSecret).toBeUndefined();
  });

  it('substitutes ${ENV} in sharedSecret', () => {
    process.env.TEST_SHARED_SECRET = 'ocp-sk-from-env';
    try {
      const yaml = `
gateway:
  sharedSecret: "\${TEST_SHARED_SECRET}"
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, yaml);

      const config = loadConfig(configPath);
      expect(config.gateway.sharedSecret).toBe('ocp-sk-from-env');
    } finally {
      delete process.env.TEST_SHARED_SECRET;
    }
  });

  it('loads complete config matching config.yaml.example structure', () => {
    const yaml = `
gateway:
  port: 8080
  host: "0.0.0.0"
  baseDomain: "portal.example.com"
  sharedSecret: "ocp-sk-change-me"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.port).toBe(8080);
    expect(config.gateway.host).toBe('0.0.0.0');
    expect(config.gateway.baseDomain).toBe('portal.example.com');
    expect(config.gateway.sharedSecret).toBe('ocp-sk-change-me');
  });

  it('oidc defaults to undefined when not configured', () => {
    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.oidc).toBeUndefined();
  });

  it('parses a complete oidc block with default scopes', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/application/o/opencode/"
    clientId: "client-abc"
    clientSecret: "secret-xyz"
    redirectUri: "https://portal.example.com/auth/callback"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc).toBeDefined();
    expect(config.gateway.oidc!.issuer).toBe('https://auth.example.com/application/o/opencode/');
    expect(config.gateway.oidc!.clientId).toBe('client-abc');
    expect(config.gateway.oidc!.clientSecret).toBe('secret-xyz');
    expect(config.gateway.oidc!.redirectUri).toBe('https://portal.example.com/auth/callback');
    expect(config.gateway.oidc!.scopes).toEqual(['openid', 'profile', 'email']);
  });

  it('honors custom oidc scopes', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
    scopes: ["openid", "email"]
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc!.scopes).toEqual(['openid', 'email']);
  });

  it('parses explicit OIDC insecure issuer dev opt-in', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "http://auth.local/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "http://portal.local/auth/callback"
    allowInsecureIssuer: true
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc!.allowInsecureIssuer).toBe(true);
  });

  it('parses a positive oidc sessionTtlHours', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
    sessionTtlHours: 12
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc!.sessionTtlHours).toBe(12);
  });

  it('sessionTtlHours defaults to undefined (follow IdP lifetime)', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc!.sessionTtlHours).toBeUndefined();
  });

  it('ignores invalid oidc sessionTtlHours (zero/negative/non-number)', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
    sessionTtlHours: 0
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc!.sessionTtlHours).toBeUndefined();

    const yaml2 = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
    sessionTtlHours: -5
`;
    const configPath2 = path.join(tmpDir, 'config2.yaml');
    fs.writeFileSync(configPath2, yaml2);
    expect(loadConfig(configPath2).gateway.oidc!.sessionTtlHours).toBeUndefined();

    const yaml3 = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "s"
    redirectUri: "https://portal.example.com/auth/callback"
    sessionTtlHours: "24"
`;
    const configPath3 = path.join(tmpDir, 'config3.yaml');
    fs.writeFileSync(configPath3, yaml3);
    expect(loadConfig(configPath3).gateway.oidc!.sessionTtlHours).toBeUndefined();
  });

  it('substitutes ${ENV} in oidc clientSecret', () => {
    process.env.TEST_OIDC_SECRET = 'secret-from-env';
    try {
      const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "\${TEST_OIDC_SECRET}"
    redirectUri: "https://portal.example.com/auth/callback"
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, yaml);

      const config = loadConfig(configPath);
      expect(config.gateway.oidc!.clientSecret).toBe('secret-from-env');
    } finally {
      delete process.env.TEST_OIDC_SECRET;
    }
  });

  it('ignores an oidc block missing required fields', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc).toBeUndefined();
  });

  it('ignores an oidc block with unresolved ${ENV} placeholders', () => {
    const yaml = `
gateway:
  oidc:
    issuer: "https://auth.example.com/"
    clientId: "c"
    clientSecret: "\${MISSING_OIDC_SECRET_VAR}"
    redirectUri: "https://portal.example.com/auth/callback"
`;
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.oidc).toBeUndefined();
  });
});
