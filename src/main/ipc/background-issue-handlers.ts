import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  backgroundIssueAcknowledgeInputSchema,
  backgroundIssueAcknowledgeResultSchema,
  legacyGenerationDismissalImportInputSchema,
  legacyGenerationDismissalImportResultSchema,
} from '@/shared/contracts/background-issue';

export function registerBackgroundIssueIpc(ipcMain: IpcHandlerRegistrar, database: LibraryDatabase) {
  ipcMain.handle('background-issue:acknowledge', (_event, raw) =>
    backgroundIssueAcknowledgeResultSchema.parse(
      database.acknowledgeBackgroundIssue(backgroundIssueAcknowledgeInputSchema.parse(raw)),
    ),
  );
  ipcMain.handle('background-issue:import-legacy-generation-dismissals', (_event, raw) =>
    legacyGenerationDismissalImportResultSchema.parse(
      database.importLegacyGenerationDismissals(legacyGenerationDismissalImportInputSchema.parse(raw)),
    ),
  );
}
