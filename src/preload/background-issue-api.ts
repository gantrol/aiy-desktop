import type { IpcRenderer } from 'electron';
import {
  backgroundIssueAcknowledgeInputSchema,
  backgroundIssueAcknowledgeResultSchema,
  legacyGenerationDismissalImportInputSchema,
  legacyGenerationDismissalImportResultSchema,
} from '@/shared/contracts/background-issue';

export function createBackgroundIssuePreloadApi(ipcRenderer: IpcRenderer) {
  return {
    backgroundIssueAcknowledge: async (input: unknown) =>
      backgroundIssueAcknowledgeResultSchema.parse(
        await ipcRenderer.invoke('background-issue:acknowledge', backgroundIssueAcknowledgeInputSchema.parse(input)),
      ),
    backgroundIssueImportLegacyGenerationDismissals: async (input: unknown) =>
      legacyGenerationDismissalImportResultSchema.parse(
        await ipcRenderer.invoke(
          'background-issue:import-legacy-generation-dismissals',
          legacyGenerationDismissalImportInputSchema.parse(input),
        ),
      ),
  };
}
