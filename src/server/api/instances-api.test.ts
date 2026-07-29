import { describe, it, expect } from 'vitest';
import * as http from 'http';
import { Router } from '../router';
import {
  BASE_DOMAIN,
  createHydratedRegistry,
  createMockReq,
  createMockReqWithBody,
  createMockRes,
} from '../test-helpers';

describe('instance CRUD API', () => {
  it('POST /api/instances creates a new instance', async () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances', 'POST',
      JSON.stringify({ id: 'test-vm', name: 'Test VM', tags: ['dev'] }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('test-vm');
    expect(body.name).toBe('Test VM');
    expect(body.tags).toEqual(['dev']);
    expect(body.assignedToken).toBeDefined();
  });

  it('POST /api/instances rejects duplicate id', async () => {
    const registry = createHydratedRegistry([{ id: 'test-vm', name: 'Existing', tags: [] }]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances', 'POST',
      JSON.stringify({ id: 'test-vm', name: 'Dup', tags: [] }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('already exists');
  });

  it('POST /api/instances rejects invalid JSON', async () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances', 'POST', 'not json');
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Invalid JSON');
  });

  it('GET /api/instances lists all instances', () => {
    const registry = createHydratedRegistry([
      { id: 'vm1', name: 'VM One', tags: ['dev'] },
      { id: 'vm2', name: 'VM Two', tags: ['prod'] },
    ]);
    const router = new Router(registry);

    const req = createMockReq('/api/instances');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('vm1');
    expect(list[0].name).toBe('VM One');
  });

  it('PATCH /api/instances/:id updates name and tags', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'Old Name', tags: ['dev'] }]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/vm1', 'PATCH',
      JSON.stringify({ name: 'New Name', tags: ['prod', 'web'] }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('New Name');
    expect(body.tags).toEqual(['prod', 'web']);
  });

  it('PATCH /api/instances/:id returns InstanceView fields', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'Shape VM', tags: ['dev'] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'secret' });
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/vm1', 'PATCH',
      JSON.stringify({ name: 'Renamed' }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('vm1');
    expect(body.name).toBe('Renamed');
    expect(body.targetHost).toBe('127.0.0.1');
    expect(body.targetPort).toBe(4096);
    expect(body.opencodeUser).toBe('alice');
    expect(body.hasOpencodePassword).toBe(true);
    // Password value must never be exposed
    expect(body.opencodePassword).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('PATCH /api/instances/:id clears opencodeUser with null', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'VM', tags: [] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'secret' });
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/vm1', 'PATCH',
      JSON.stringify({ opencodeUser: null }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(200);
    expect(registry.getOpencodeUser('vm1')).toBeUndefined();
    expect(registry.getOpencodePassword('vm1')).toBe('secret');
  });

  it('PATCH /api/instances/:id clears opencodePassword with null', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'VM', tags: [] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'secret' });
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/vm1', 'PATCH',
      JSON.stringify({ opencodePassword: null }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(200);
    expect(registry.getOpencodePassword('vm1')).toBeUndefined();
    expect(registry.getOpencodeUser('vm1')).toBe('alice');
  });

  it('PATCH omitting credentials leaves them unchanged', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'VM', tags: [] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'secret' });
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/vm1', 'PATCH',
      JSON.stringify({ name: 'Renamed' }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(200);
    expect(registry.get('vm1')!.name).toBe('Renamed');
    expect(registry.getOpencodeUser('vm1')).toBe('alice');
    expect(registry.getOpencodePassword('vm1')).toBe('secret');
  });

  it('GET /api/instances reflects cleared credentials', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'VM', tags: [] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'secret' });
    registry.update('vm1', { opencodeUser: null, opencodePassword: null });
    const router = new Router(registry);

    const req = createMockReq('/api/instances');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body);
    expect(list[0].opencodeUser).toBe('');
    expect(list[0].hasOpencodePassword).toBe(false);
  });

  it('GET /api/instances/:id/deploy never exposes upstream OpenCode credentials to the Agent', async () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'Deploy VM', tags: ['dev'] }]);
    registry.update('vm1', { opencodeUser: 'alice', opencodePassword: 'upstream-secret' });
    const router = new Router(registry, undefined, 'portal.example.com', 8443);

    const req = createMockReq('/api/instances/vm1/deploy');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dockerRun).not.toContain('OPENCODE_USER');
    expect(body.dockerRun).not.toContain('OPENCODE_SERVER_PASSWORD');
    expect(body.dockerUpgrade).not.toContain('OPENCODE_USER');
    expect(body.dockerUpgrade).not.toContain('OPENCODE_SERVER_PASSWORD');
    expect(body.composeFile).not.toContain('OPENCODE_USER');
    expect(body.composeFile).not.toContain('OPENCODE_SERVER_PASSWORD');
    expect(body.composeEnv).not.toContain('OPENCODE_USER');
    expect(body.composeEnv).not.toContain('OPENCODE_SERVER_PASSWORD');
    expect(JSON.stringify(body)).not.toContain('alice');
    expect(JSON.stringify(body)).not.toContain('upstream-secret');
  });

  it('POST /api/instances ignores null credentials', async () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances', 'POST',
      JSON.stringify({
        id: 'test-vm',
        name: 'Test VM',
        tags: [],
        opencodeUser: null,
        opencodePassword: null,
      }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(201);
    expect(registry.getOpencodeUser('test-vm')).toBeUndefined();
    expect(registry.getOpencodePassword('test-vm')).toBeUndefined();
  });

  it('PATCH /api/instances/:id returns 404 for unknown id', async () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = createMockReqWithBody('/api/instances/nope', 'PATCH',
      JSON.stringify({ name: 'x' }));
    const res = createMockRes();
    router.handleRequest(req, res as any);
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/instances/:id removes an instance', () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'To Delete', tags: [] }]);
    const router = new Router(registry);

    expect(registry.get('vm1')).toBeDefined();

    const req = createMockReq('/api/instances/vm1', 'DELETE');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).deleted).toBe(true);
    expect(registry.get('vm1')).toBeUndefined();
  });

  it('DELETE /api/instances/:id returns 404 for unknown id', () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = createMockReq('/api/instances/nope', 'DELETE');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/instances/:id/deploy returns deploy instructions', () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'Deploy VM', tags: ['dev'] }]);
    const router = new Router(registry, undefined, 'portal.example.com', 8443);

    const req = createMockReq('/api/instances/vm1/deploy');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.instanceId).toBe('vm1');
    expect(body.name).toBe('Deploy VM');
    expect(body.assignedToken).toBeDefined();
    expect(body.dockerRun).toContain('AGENT_REGISTRATION_TOKEN=');
    expect(body.dockerRun).toContain('portal.example.com');
    expect(body.dockerRun).toContain('-v ocp-agent-vm1-data:/app/data');
    expect(body.dockerUpgrade).toContain('-v ocp-agent-vm1-data:/app/data');
    expect(body.dockerUpgrade).toContain('docker pull ghcr.io/qcnx/opencode-portal-agent:latest');
    expect(body.dockerUpgrade).toContain('docker rm -f ocp-agent-vm1');
    expect(body.dockerUpgrade).toContain(body.dockerRun);
    expect(body.dockerUpgrade).toContain('docker ps --filter name=ocp-agent-vm1');
    expect(body.dockerUpgrade).not.toContain('\n+');
    expect(body.composeFile).toContain('AGENT_REGISTRATION_TOKEN: ${AGENT_REGISTRATION_TOKEN:?err}');
    expect(body.composeFile).toContain('GATEWAY_URL: ${GATEWAY_URL:-wss://portal.example.com/agent/connect}');
    expect(body.composeFile).toContain('agent-data:/app/data');
    expect(body.composeEnv).toContain('AGENT_REGISTRATION_TOKEN=');
    expect(body.composeUpgrade).toContain('docker compose pull opencode-agent');
    expect(body.composeUpgrade).toContain('docker compose up -d --force-recreate opencode-agent');
    expect(body.composeUpgrade).toContain('docker compose ps opencode-agent');
    expect(body.composeUpgrade).not.toContain('\n+');
  });

  it('quotes Agent deploy environment values for shell and .env safety', () => {
    const registry = createHydratedRegistry([{ id: 'vm1', name: 'Deploy VM', tags: ['dev'] }]);
    registry.update('vm1', { targetHost: "host name'$(touch /tmp/pwn)" });
    const router = new Router(registry, undefined, 'portal.example.com', 8443);

    const req = createMockReq('/api/instances/vm1/deploy');
    const res = createMockRes();
    router.handleRequest(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dockerRun).toContain("AGENT_TARGET_HOST='host name'\\''$(touch /tmp/pwn)'");
    expect(body.dockerUpgrade).toContain("AGENT_TARGET_HOST='host name'\\''$(touch /tmp/pwn)'");
    expect(body.composeEnv).toContain("AGENT_TARGET_HOST=\"host name'$(touch /tmp/pwn)\"");
  });

  it('auth: CRUD endpoints return 401 when auth is enabled', () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry, 'secret123', BASE_DOMAIN);

    for (const method of ['GET', 'POST']) {
      const req = createMockReq('/api/instances', method);
      const res = createMockRes();
      router.handleRequest(req, res as any);
      expect(res.statusCode).toBe(401);
    }

    const patchReq = createMockReq('/api/instances/vm1', 'PATCH');
    const patchRes = createMockRes();
    router.handleRequest(patchReq, patchRes as any);
    expect(patchRes.statusCode).toBe(401);

    const delReq = createMockReq('/api/instances/vm1', 'DELETE');
    const delRes = createMockRes();
    router.handleRequest(delReq, delRes as any);
    expect(delRes.statusCode).toBe(401);
  });

  it('POST /api/instances rejects oversized body', async () => {
    const registry = createHydratedRegistry([]);
    const router = new Router(registry);

    const req = new http.IncomingMessage({} as any);
    req.url = '/api/instances';
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json' };
    const res = createMockRes();
    router.handleRequest(req, res as any);
    req.emit('data', Buffer.alloc(65 * 1024));
    await new Promise(r => setTimeout(r, 15));

    expect(res.statusCode).toBe(413);
  });
});
