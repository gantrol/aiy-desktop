import type { IpcRenderer } from 'electron';
import {
  publishingMaskDraftSchema,
  publishingMaskReadResultSchema,
  publishingMaskSaveInputSchema,
  publishingMaskScopeSchema,
  type PublishingMasksApi,
} from '@/shared/contracts/publishing-mask';

export function createPublishingMasksApi(ipc: Pick<IpcRenderer, 'invoke'>): PublishingMasksApi {
  return {
    get: async (input) =>
      publishingMaskDraftSchema
        .nullable()
        .parse(await ipc.invoke('publishing-masks:get', publishingMaskScopeSchema.parse(input))),
    read: async (input) =>
      publishingMaskReadResultSchema.parse(
        await ipc.invoke('publishing-masks:read', publishingMaskScopeSchema.parse(input)),
      ),
    save: async (input) =>
      publishingMaskDraftSchema.parse(
        await ipc.invoke('publishing-masks:save', publishingMaskSaveInputSchema.parse(input)),
      ),
  };
}
