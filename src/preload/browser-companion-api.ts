import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  tablePublicationInputSchema,
  tablePublicationResultSchema,
  tablePublicationDiscardSchema,
} from '@/shared/contracts/table-publication';
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
  browserCompanionBatchHistoryInputSchema,
  browserCompanionReopenInputSchema,
} from '@/shared/contracts/browser-companion';

export function createBrowserCompanionPreloadApi(
  ipcRenderer: Pick<IpcRenderer, 'invoke'>,
): Pick<
  DesktopApi,
  | 'browserCompanionStage'
  | 'browserCompanionPrepareTables'
  | 'browserCompanionDiscardTablePreviews'
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
    browserCompanionDiscardTablePreviews: async (input) => {
      await ipcRenderer.invoke('browser-companion:discard-table-previews', tablePublicationDiscardSchema.parse(input));
    },
    browserCompanionPrepareTables: async (input) => {
      const result = await ipcRenderer.invoke(
        'browser-companion:prepare-tables',
        tablePublicationInputSchema.parse(input),
      );
      if (result && 'errorCode' in result) throw new Error(result.errorCode);
      return tablePublicationResultSchema.parse(result);
    },
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
    browserCompanionBatchHistory: async (input) =>
      browserCompanionBatchHistoryResultSchema.parse(
        await ipcRenderer.invoke(
          'browser-companion:batch-history',
          browserCompanionBatchHistoryInputSchema.parse(input ?? {}),
        ),
      ),
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
