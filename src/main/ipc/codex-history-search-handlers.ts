import type { CodexHistorySearch } from '@/main/extensions/codex-history-search';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  codexHistoryFilterOptionsInputSchema,
  codexHistoryRefreshInputSchema,
  codexHistorySearchInputSchema,
} from '@/shared/contracts/codex-history-search';
import { CODEX_HISTORY_SEARCH_EXTENSION_ID } from '@/shared/extension-ids';

export function registerCodexHistorySearchIpc(
  ipcMain: IpcHandlerRegistrar,
  extensions: ExtensionRegistry,
  historySearch: CodexHistorySearch,
) {
  const active = () => {
    if (!extensions.isActivated(CODEX_HISTORY_SEARCH_EXTENSION_ID)) {
      throw new Error('Codex History Search is disabled or missing permissions');
    }
    historySearch.setActive(true);
  };
  ipcMain.handle('codex-history-search:state', async () => {
    active();
    return await historySearch.state();
  });
  ipcMain.handle('codex-history-search:query', async (_event, raw) => {
    active();
    return await historySearch.search(codexHistorySearchInputSchema.parse(raw));
  });
  ipcMain.handle('codex-history-search:filter-options', async (_event, raw) => {
    active();
    return await historySearch.filterOptions(codexHistoryFilterOptionsInputSchema.parse(raw));
  });
  ipcMain.handle('codex-history-search:refresh', async (_event, raw) => {
    active();
    return await historySearch.refresh(codexHistoryRefreshInputSchema.parse(raw));
  });
}
