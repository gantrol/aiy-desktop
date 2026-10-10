import { BrowserCompanionRuntime } from '@/main/browser-companion/runtime';
import {
  tablePublicationInputSchema,
  tablePublicationResultSchema,
  tablePublicationDiscardSchema,
} from '@/shared/contracts/table-publication';
import { discardTablePublications } from '@/main/browser-companion/table-publication-cache';
import { cancelTablePublication } from '@/main/browser-companion/table-publication-service';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  browserCompanionDestinationSelectInputSchema,
  browserCompanionDestinationsResultSchema,
  browserCompanionDeleteInputSchema,
  browserCompanionDeleteResultSchema,
  browserCompanionHistoryResultSchema,
  browserCompanionOpenInputSchema,
  browserCompanionOpenResultSchema,
  browserCompanionStageInputSchema,
  browserCompanionStageErrorCodeSchema,
  browserCompanionStageResultSchema,
  browserCompanionBatchInputSchema,
  browserCompanionBatchResultSchema,
  browserCompanionBatchHistoryResultSchema,
  browserCompanionBatchHistoryInputSchema,
  browserCompanionBatchInvocationSchema,
  browserCompanionReopenInvocationSchema,
  browserCompanionReopenInputSchema,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';
import { WEIBO_CHANNEL_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

export function registerBrowserCompanionIpc(
  ipcMain: IpcHandlerRegistrar,
  runtime: BrowserCompanionRuntime,
  extensions: ExtensionRegistry,
): void {
  const canStage = (target: BrowserCompanionTarget): boolean =>
    target !== 'weibo' ||
    (extensions.isActivated(WEIBO_CHANNEL_EXTENSION_ID) &&
      extensions.isPermissionGranted(WEIBO_CHANNEL_EXTENSION_ID, EXTENSION_PERMISSION.browserHandoffWeibo));
  ipcMain.handle('browser-companion:prepare-tables', async (_event, rawInput) => {
    const input = tablePublicationInputSchema.parse(rawInput);
    if (!canStage(input.target)) throw new Error('HANDOFF_NOT_ALLOWED');
    try {
      return tablePublicationResultSchema.parse(await runtime.prepareTables(input));
    } catch (reason) {
      const code = browserCompanionStageErrorCodeSchema.safeParse(reason instanceof Error ? reason.message : reason);
      return { errorCode: code.success ? code.data : 'TABLE_RENDER_FAILED' };
    }
  });
  ipcMain.handle('browser-companion:discard-table-previews', async (_event, rawInput) => {
    const input = tablePublicationDiscardSchema.parse(rawInput);
    cancelTablePublication(input.ids, input.expectedSpaceId);
    discardTablePublications(input.ids, input.expectedSpaceId);
  });
  ipcMain.handle('browser-companion:stage-batch', async (_event, rawInput) => {
    try {
      return browserCompanionBatchResultSchema.parse(
        await runtime.stageBatch(browserCompanionBatchInputSchema.parse(rawInput), canStage),
      );
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'BROWSER_COMPANION_LIBRARY_CHANGED') {
        return browserCompanionBatchInvocationSchema.parse({ errorCode: reason.message });
      }
      throw reason;
    }
  });
  ipcMain.handle('browser-companion:batch-history', async (_event, raw) =>
    browserCompanionBatchHistoryResultSchema.parse(
      await runtime.batchHistory(browserCompanionBatchHistoryInputSchema.parse(raw ?? {}).includeHistory),
    ),
  );
  ipcMain.handle('browser-companion:reopen', async (_event, rawInput) => {
    const input = browserCompanionReopenInputSchema.parse(rawInput);
    try {
      return browserCompanionStageResultSchema.parse(
        await runtime.reopen(input.handoffId, canStage, input.expectedSpaceId),
      );
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'BROWSER_COMPANION_LIBRARY_CHANGED') {
        return browserCompanionReopenInvocationSchema.parse({ errorCode: reason.message });
      }
      throw reason;
    }
  });
  ipcMain.handle('browser-companion:stage', async (_event, rawInput) => {
    const input = browserCompanionStageInputSchema.parse(rawInput);
    if (!canStage(input.target)) {
      throw new Error('Weibo browser handoff is disabled or missing permission');
    }
    try {
      return browserCompanionStageResultSchema.parse(await runtime.stage(input, canStage));
    } catch (reason) {
      const code = browserCompanionStageErrorCodeSchema.safeParse(reason instanceof Error ? reason.message : reason);
      if (code.success) return { errorCode: code.data };
      throw reason;
    }
  });
  ipcMain.handle('browser-companion:destinations', async () =>
    browserCompanionDestinationsResultSchema.parse(await runtime.destinations()),
  );
  ipcMain.handle('browser-companion:open', async (_event, rawInput) => {
    const input = browserCompanionOpenInputSchema.parse(rawInput);
    return browserCompanionOpenResultSchema.parse(await runtime.open(input.target));
  });
  ipcMain.handle('browser-companion:select-destination', async (_event, rawInput) => {
    const input = browserCompanionDestinationSelectInputSchema.parse(rawInput);
    return browserCompanionDestinationsResultSchema.parse(
      await runtime.selectDestination(input.target, input.browserId, input.profileDirectory),
    );
  });
  ipcMain.handle('browser-companion:history', async () =>
    browserCompanionHistoryResultSchema.parse(await runtime.history()),
  );
  ipcMain.handle('browser-companion:delete', async (_event, rawInput) =>
    browserCompanionDeleteResultSchema.parse(await runtime.delete(browserCompanionDeleteInputSchema.parse(rawInput))),
  );
}
