import { ipcRenderer } from 'electron';
import { agentPermissionsSchema, type AgentPermissionsApi } from '@/shared/contracts/agent-permissions';

export function createAgentPermissionsApi(): AgentPermissionsApi {
  return {
    read: async () => agentPermissionsSchema.parse(await ipcRenderer.invoke('agent-permissions:read')),
    save: async (input) =>
      agentPermissionsSchema.parse(
        await ipcRenderer.invoke('agent-permissions:save', agentPermissionsSchema.parse(input)),
      ),
  };
}
