// ---------------------------------------------------------------------------
// Tests: agent/config.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, loadAgentState, saveAgentState } from './config';

describe('agent/loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-test-'));
    // Ensure env vars don't leak between tests
    delete process.env.GATEWAY_URL;
    delete process.env.AGENT_REGISTRATION_TOKEN;
    delete process.env.AGENT_TARGET_PORT;
    delete process.env.AGENT_MAX_SOCKETS;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.GATEWAY_URL;
    delete process.env.AGENT_REGISTRATION_TOKEN;
    delete process.env.AGENT_TARGET_PORT;
    delete process.env.AGENT_MAX_SOCKETS;
  });

  it('loads full agent config from YAML file', () => {
    const yaml = `
gateway:
  url: "ws://gateway.example.com:8080/agent/connect"
registrationToken: "ocp-at-my-secret-token"
targetPort: 3002
reconnect:
  baseDelayMs: 2000
  maxDelayMs: 30000
heartbeat:
  intervalMs: 15000
`;
    const configPath = path.join(tmpDir, 'agent.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.url).toBe('ws://gateway.example.com:8080/agent/connect');
    expect(config.registrationToken).toBe('ocp-at-my-secret-token');
    expect(config.targetPort).toBe(3002);
    expect(config.reconnect.baseDelayMs).toBe(2000);
    expect(config.reconnect.maxDelayMs).toBe(30000);
    expect(config.heartbeat.intervalMs).toBe(15000);
  });

  it('uses defaults when config file does not exist (but token from env)', () => {
    process.env.AGENT_REGISTRATION_TOKEN = 'ocp-at-env-token';
    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.url).toBe('ws://localhost:8080/agent/connect');
    expect(config.targetPort).toBe(4096);
    expect(config.reconnect.baseDelayMs).toBe(1000);
    expect(config.reconnect.maxDelayMs).toBe(60000);
    expect(config.heartbeat.intervalMs).toBe(30000);
  });

  it('falls back to env vars for gateway URL and target port', () => {
    process.env.GATEWAY_URL = 'ws://custom:9000/connect';
    process.env.AGENT_REGISTRATION_TOKEN = 'ocp-at-env-token';
    process.env.AGENT_TARGET_PORT = '4000';

    const config = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(config.gateway.url).toBe('ws://custom:9000/connect');
    expect(config.registrationToken).toBe('ocp-at-env-token');
    expect(config.targetPort).toBe(4000);
  });

  it('YAML file wins over env vars', () => {
    process.env.GATEWAY_URL = 'ws://env:9000/connect';
    process.env.AGENT_REGISTRATION_TOKEN = 'ocp-at-env-token';
    process.env.AGENT_TARGET_PORT = '9999';

    const yaml = `
gateway:
  url: "ws://yaml:8080/connect"
registrationToken: "ocp-at-yaml-token"
targetPort: 3001
`;
    const configPath = path.join(tmpDir, 'agent.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.url).toBe('ws://yaml:8080/connect');
    expect(config.registrationToken).toBe('ocp-at-yaml-token');
    expect(config.targetPort).toBe(3001);
  });

  it('substitutes ${ENV} placeholders in YAML file values', () => {
    process.env.TEST_AGENT_TOKEN = 'ocp-at-substituted';
    process.env.TEST_GATEWAY_URL = 'ws://env-gateway:8080/agent/connect';
    try {
      const yaml = `
gateway:
  url: "\${TEST_GATEWAY_URL}"
registrationToken: "\${TEST_AGENT_TOKEN}"
targetPort: 3001
`;
      const configPath = path.join(tmpDir, 'agent.yaml');
      fs.writeFileSync(configPath, yaml);

      const config = loadConfig(configPath);
      expect(config.gateway.url).toBe('ws://env-gateway:8080/agent/connect');
      expect(config.registrationToken).toBe('ocp-at-substituted');
    } finally {
      delete process.env.TEST_AGENT_TOKEN;
      delete process.env.TEST_GATEWAY_URL;
    }
  });

  it('exits with error when no token is configured anywhere', () => {
    // Mock process.exit to avoid actually exiting
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => {
      loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    }).toThrow('process.exit called');

    exitSpy.mockRestore();
  });

  it('partial YAML merges with defaults', () => {
    const yaml = `
gateway:
  url: "ws://partial:8080"
registrationToken: "ocp-at-partial"
`;
    const configPath = path.join(tmpDir, 'agent.yaml');
    fs.writeFileSync(configPath, yaml);

    const config = loadConfig(configPath);
    expect(config.gateway.url).toBe('ws://partial:8080');
    expect(config.registrationToken).toBe('ocp-at-partial');
    expect(config.targetPort).toBe(4096); // default
    expect(config.reconnect.baseDelayMs).toBe(1000); // default
    expect(config.heartbeat.intervalMs).toBe(30000); // default
  });

  it('reads maxSockets from env and YAML', () => {
    process.env.AGENT_REGISTRATION_TOKEN = 'ocp-at-env-token';
    process.env.AGENT_MAX_SOCKETS = '120';
    const fromEnv = loadConfig(path.join(tmpDir, 'nonexistent.yaml'));
    expect(fromEnv.maxSockets).toBe(120);

    const yaml = `
gateway:
  url: "ws://yaml:8080/connect"
registrationToken: "ocp-at-yaml-token"
maxSockets: 80
`;
    const configPath = path.join(tmpDir, 'agent.yaml');
    fs.writeFileSync(configPath, yaml);
    const fromYaml = loadConfig(configPath);
    expect(fromYaml.maxSockets).toBe(80);
  });

  it('saves agent state with restrictive file permissions', () => {
    saveAgentState('vm-1', 'ocp-at-secret', tmpDir);
    const loaded = loadAgentState(tmpDir);
    expect(loaded).toEqual({ instanceId: 'vm-1', token: 'ocp-at-secret' });
    if (process.platform !== 'win32') {
      expect((fs.statSync(tmpDir).mode & 0o777)).toBe(0o700);
      expect((fs.statSync(path.join(tmpDir, 'agent-state.jsonc')).mode & 0o777)).toBe(0o600);
    }
  });
});
