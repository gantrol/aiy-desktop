import { BrowserCompanionRuntime } from '@/main/browser-companion/runtime';
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
  browserCompanionStageResultSchema,
} from '@/shared/contracts/browser-companion';
import { WEIBO_CHANNEL_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

export function registerBrowserCompanionIpc(
  ipcMain: IpcHandlerRegistrar,
  runtime: BrowserCompanionRuntime,
  extensions: ExtensionRegistry,
): void {
  ipcMain.handle('browser-companion:stage', async (_event, rawInput) => {
    const input = browserCompanionStageInputSchema.parse(rawInput);
    if (
      input.target === 'weibo' &&
      (!extensions.isActivated(WEIBO_CHANNEL_EXTENSION_ID) ||
        !extensions.isPermissionGranted(WEIBO_CHANNEL_EXTENSION_ID, EXTENSION_PERMISSION.browserHandoffWeibo))
    ) {
      throw new Error('Weibo browser handoff is disabled or missing permission');
    }
    return browserCompanionStageResultSchema.parse(await runtime.stage(input));
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
