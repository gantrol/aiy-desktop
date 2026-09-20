import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  browserCompanionDeleteInputSchema,
  browserCompanionDeleteResultSchema,
  browserCompanionDestinationSelectInputSchema,
  browserCompanionDestinationsResultSchema,
  browserCompanionHistoryResultSchema,
  browserCompanionOpenInputSchema,
  browserCompanionOpenResultSchema,
  browserCompanionStageInputSchema,
  browserCompanionStageInvocationSchema,
  browserCompanionBatchInputSchema,
  browserCompanionBatchInvocationSchema,
  browserCompanionReopenInvocationSchema,
  browserCompanionBatchHistoryResultSchema,
  browserCompanionReopenInputSchema,
} from '@/shared/contracts/browser-companion';

export function createBrowserCompanionPreloadApi(
  ipcRenderer: Pick<IpcRenderer, 'invoke'>,
): Pick<
  DesktopApi,
  | 'browserCompanionStage'
  | 'browserCompanionDestinations'
  | 'browserCompanionStageBatch'
  | 'browserCompanionBatchHistory'
  | 'browserCompanionReopen'
  | 'browserCompanionOpen'
  | 'browserCompanionSelectDestination'
  | 'browserCompanionHistory'
  | 'browserCompanionDelete'
> {
  return {
    browserCompanionStage: async (input) => {
      const result = browserCompanionStageInvocationSchema.parse(
        await ipcRenderer.invoke('browser-companion:stage', browserCompanionStageInputSchema.parse(input)),
      );
      if ('errorCode' in result) throw new Error(result.errorCode);
      return result;
    },
    browserCompanionDestinations: async () =>
      browserCompanionDestinationsResultSchema.parse(await ipcRenderer.invoke('browser-companion:destinations')),
    browserCompanionStageBatch: async (input) => {
      const result = browserCompanionBatchInvocationSchema.parse(
        await ipcRenderer.invoke('browser-companion:stage-batch', browserCompanionBatchInputSchema.parse(input)),
      );
      if ('errorCode' in result)
        throw Object.assign(new Error(result.errorCode), { code: result.errorCode, admissionRejected: true });
      return result;
    },
    browserCompanionBatchHistory: async () =>
      browserCompanionBatchHistoryResultSchema.parse(await ipcRenderer.invoke('browser-companion:batch-history')),
    browserCompanionReopen: async (input) => {
      const result = browserCompanionReopenInvocationSchema.parse(
        await ipcRenderer.invoke('browser-companion:reopen', browserCompanionReopenInputSchema.parse(input)),
      );
      if ('errorCode' in result)
        throw Object.assign(new Error(result.errorCode), { code: result.errorCode, admissionRejected: true });
      return result;
    },
    browserCompanionOpen: async (input) =>
      browserCompanionOpenResultSchema.parse(
        await ipcRenderer.invoke('browser-companion:open', browserCompanionOpenInputSchema.parse(input)),
      ),
    browserCompanionSelectDestination: async (input) =>
      browserCompanionDestinationsResultSchema.parse(
        await ipcRenderer.invoke(
          'browser-companion:select-destination',
          browserCompanionDestinationSelectInputSchema.parse(input),
        ),
      ),
    browserCompanionHistory: async () =>
      browserCompanionHistoryResultSchema.parse(await ipcRenderer.invoke('browser-companion:history')),
    browserCompanionDelete: async (input) =>
      browserCompanionDeleteResultSchema.parse(
        await ipcRenderer.invoke('browser-companion:delete', browserCompanionDeleteInputSchema.parse(input)),
      ),
  };
}
