import { ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  codexUsageCleanupInputSchema,
  codexUsageCleanupResultSchema,
  codexUsageExportInputSchema,
  codexUsageExportResultSchema,
  codexUsageInvestigationGetInputSchema,
  codexUsageInvestigationSchema,
  codexUsageResumeInputSchema,
  codexUsageScanInputSchema,
  codexUsageStateSchema,
  codexUsageTaskSchema,
  codexUsageStateInputSchema,
} from '@/shared/contracts/codex-usage';

export const codexUsageApi: Pick<
  DesktopApi,
  | 'codexUsageState'
  | 'codexUsageInvestigation'
  | 'codexUsageScan'
  | 'codexUsageResume'
  | 'codexUsagePause'
  | 'codexUsageClear'
  | 'codexUsageExport'
  | 'onCodexUsageTaskChanged'
> = {
  codexUsageState: async (input) =>
    codexUsageStateSchema.parse(
      await ipcRenderer.invoke('codex-usage:state', codexUsageStateInputSchema.parse(input ?? {})),
    ),
  codexUsageInvestigation: async (input) =>
    codexUsageInvestigationSchema.parse(
      await ipcRenderer.invoke('codex-usage:investigation', codexUsageInvestigationGetInputSchema.parse(input)),
    ),
  codexUsageScan: async (input) =>
    codexUsageTaskSchema.parse(await ipcRenderer.invoke('codex-usage:scan', codexUsageScanInputSchema.parse(input))),
  codexUsageResume: async (input) =>
    codexUsageTaskSchema.parse(
      await ipcRenderer.invoke('codex-usage:resume', codexUsageResumeInputSchema.parse(input)),
    ),
  codexUsagePause: () => ipcRenderer.invoke('codex-usage:pause'),
  codexUsageClear: async (input) =>
    codexUsageCleanupResultSchema.parse(
      await ipcRenderer.invoke('codex-usage:clear', codexUsageCleanupInputSchema.parse(input)),
    ),
  codexUsageExport: async (input) =>
    codexUsageExportResultSchema.parse(
      await ipcRenderer.invoke('codex-usage:export', codexUsageExportInputSchema.parse(input)),
    ),
  onCodexUsageTaskChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(codexUsageTaskSchema.parse(value));
    ipcRenderer.on('codex-usage:task-changed', listener);
    return () => ipcRenderer.removeListener('codex-usage:task-changed', listener);
  },
};
