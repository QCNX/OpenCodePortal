import * as http from 'http';
import { InstanceRegistry } from '../registry';
import { readRequestBodyOrRespond } from '../http/body';
import { jsonResponse } from '../http/responses';
import { buildDeployInstructions } from './deploy-instructions';
import { toInstanceView } from './instance-view';

export interface InstancesApiOptions {
  registry: InstanceRegistry;
  baseDomain: string;
  agentImage: string;
  isAuthenticated: (req: http.IncomingMessage) => boolean;
}

function normalizeCredentialForCreate(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') return undefined;
  return value || undefined;
}

export class InstancesApi {
  constructor(private options: InstancesApiOptions) {}

  async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    method: string,
  ): Promise<boolean> {
    if (path === '/api/instances' && method === 'GET') {
      if (!this.requireAuth(req, res)) return true;
      const result = this.options.registry.list().map((inst) => toInstanceView(this.options.registry, inst));
      jsonResponse(res, 200, result);
      return true;
    }

    if (path === '/api/instances' && method === 'POST') {
      if (!this.requireAuth(req, res)) return true;
      const data = await this.readJsonBody(req, res);
      if (data === null) return true;

      const err = this.options.registry.create(
        data.id,
        data.name,
        data.tags || [],
        {
          targetHost: data.targetHost,
          targetPort: data.targetPort,
          opencodeUser: normalizeCredentialForCreate(data.opencodeUser),
          opencodePassword: normalizeCredentialForCreate(data.opencodePassword),
        },
      );
      if (err) {
        jsonResponse(res, 400, { error: err });
        return true;
      }

      const inst = this.options.registry.get(data.id);
      const token = this.options.registry.getAssignedToken(data.id);
      if (!inst) {
        res.writeHead(500);
        res.end('Internal error');
        return true;
      }

      jsonResponse(res, 201, {
        ...toInstanceView(this.options.registry, inst),
        assignedToken: token,
      });
      return true;
    }

    if (method === 'GET' && path.startsWith('/api/instances/') && path.endsWith('/deploy')) {
      if (!this.requireAuth(req, res)) return true;
      const id = path.slice('/api/instances/'.length, -'/deploy'.length);
      const inst = this.options.registry.get(id);
      const token = this.options.registry.getAssignedToken(id);
      if (!inst || !token) {
        res.writeHead(404);
        res.end('Instance not found');
        return true;
      }

      const instance = toInstanceView(this.options.registry, inst);
      jsonResponse(res, 200, buildDeployInstructions({
        instanceId: inst.id,
        name: inst.name,
        token,
        baseDomain: this.options.baseDomain,
        agentImage: this.options.agentImage,
        targetHost: instance.targetHost,
        targetPort: instance.targetPort,
      }));
      return true;
    }

    if (method === 'PATCH' && path.startsWith('/api/instances/')) {
      if (!this.requireAuth(req, res)) return true;
      const id = path.slice('/api/instances/'.length);
      if (!id) {
        res.writeHead(400);
        res.end('Missing instance id');
        return true;
      }

      const data = await this.readJsonBody(req, res);
      if (data === null) return true;
      const err = this.options.registry.update(id, data);
      if (err) {
        jsonResponse(res, 404, { error: err });
        return true;
      }

      const inst = this.options.registry.get(id);
      if (!inst) {
        res.writeHead(500);
        res.end('Internal error');
        return true;
      }
      jsonResponse(res, 200, toInstanceView(this.options.registry, inst));
      return true;
    }

    if (method === 'DELETE' && path.startsWith('/api/instances/')) {
      if (!this.requireAuth(req, res)) return true;
      const id = path.slice('/api/instances/'.length);
      if (!id) {
        res.writeHead(400);
        res.end('Missing instance id');
        return true;
      }

      const ok = this.options.registry.remove(id);
      if (!ok) {
        res.writeHead(404);
        res.end('Instance not found');
        return true;
      }
      jsonResponse(res, 200, { deleted: true });
      return true;
    }

    return false;
  }

  private requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (this.options.isAuthenticated(req)) return true;
    res.writeHead(401);
    res.end('Unauthorized');
    return false;
  }

  private async readJsonBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<any | null> {
    const body = await readRequestBodyOrRespond(req, res);
    if (body === null) return null;
    try {
      return JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
      return null;
    }
  }
}
