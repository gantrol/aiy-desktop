import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  providerConnectionListSchema,
  providerConnectionSaveInputSchema,
  providerConnectionSchema,
  providerConnectionTargetInputSchema,
} from '@/shared/contracts/provider-connections';

type ProviderConnectionPreloadApi = Pick<
  DesktopApi,
  'providerConnectionsList' | 'providerConnectionSave' | 'providerConnectionVerify' | 'providerConnectionRemove'
>;

export function createProviderConnectionPreloadApi(ipcRenderer: IpcRenderer): ProviderConnectionPreloadApi {
  const invokeTarget = async (channel: string, connectionId: string) =>
    providerConnectionSchema.parse(
      await ipcRenderer.invoke(channel, providerConnectionTargetInputSchema.parse({ connectionId })),
    );

  return {
    providerConnectionsList: async () =>
      providerConnectionListSchema.parse(await ipcRenderer.invoke('provider-connections:list')),
    providerConnectionSave: async (input) =>
      providerConnectionSchema.parse(
        await ipcRenderer.invoke('provider-connection:save', providerConnectionSaveInputSchema.parse(input)),
      ),
    providerConnectionVerify: (connectionId) => invokeTarget('provider-connection:verify', connectionId),
    providerConnectionRemove: (connectionId) => invokeTarget('provider-connection:remove', connectionId),
  };
}
