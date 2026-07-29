import { InstanceRegistry } from '../registry';

export interface RegistryInstance {
  id: string;
  name: string;
  tags: string[];
  status: string;
  sessionCount: number;
  lastSeen: number;
  connectedAt: number;
  agentVersion?: string;
  opencodeVersion?: string;
}

export interface InstanceView extends RegistryInstance {
  targetHost: string;
  targetPort: number;
  opencodeUser: string;
  /** True when a password is configured; value is never sent to the browser. */
  hasOpencodePassword: boolean;
}

export function toInstanceView(registry: InstanceRegistry, inst: RegistryInstance): InstanceView {
  return {
    ...inst,
    targetHost: registry.getTargetHost(inst.id) || '127.0.0.1',
    targetPort: registry.getTargetPort(inst.id) || 4096,
    opencodeUser: registry.getOpencodeUser(inst.id) || '',
    hasOpencodePassword: !!registry.getOpencodePassword(inst.id),
  };
}
