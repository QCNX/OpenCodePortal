import type { ControlMessage } from '../shared/types';

export interface AgentTransport {
  sendToAgent(instanceId: string, requestId: number, payload: Buffer): boolean;
  sendControlToAgent(instanceId: string, message: ControlMessage): void;
}
