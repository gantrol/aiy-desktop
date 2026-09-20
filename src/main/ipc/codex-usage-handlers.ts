import path from 'node:path';
import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
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
} from '@/shared/contracts/codex-usage';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';

interface Options {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  dataDirectory: string;
  chooseSaveFile(options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  sendRendererEvent(channel: string, ...args: unknown[]): boolean;
}

export interface CodexUsageIpcController {
  readonly hasPending: boolean;
  cancel(): void;
}

function defaultExportName(format: 'CSV' | 'JSON') {
  const date = new Date().toISOString().slice(0, 10);
  return `AIY-Codex-usage-${date}.${format.toLowerCase()}`;
}

export function registerCodexUsageIpc({
  ipcMain,
  extensions,
  dataDirectory,
  chooseSaveFile,
  sendRendererEvent,
}: Options): CodexUsageIpcController {
  const investigator = new CodexUsageInvestigator({
    dataDirectory,
    onTaskChanged: (task) => sendRendererEvent('codex-usage:task-changed', codexUsageTaskSchema.parse(task)),
  });
  const active = () => {
    if (!extensions.isActivated(CODEX_EXTENSION_ID)) {
      throw new Error('Did Codex Work Hard Today? is disabled or missing permissions');
    }
  };
  ipcMain.handle('codex-usage:state', async () => {
    active();
    return codexUsageStateSchema.parse(await investigator.state());
  });
  ipcMain.handle('codex-usage:investigation', async (_event, raw) => {
    active();
    const input = codexUsageInvestigationGetInputSchema.parse(raw);
    return codexUsageInvestigationSchema.parse(
      await investigator.investigation(input.investigationId, input.minimumQuotaPercent),
    );
  });
  ipcMain.handle('codex-usage:scan', async (_event, raw) => {
    active();
    return codexUsageTaskSchema.parse(await investigator.start(codexUsageScanInputSchema.parse(raw)));
  });
  ipcMain.handle('codex-usage:resume', async (_event, raw) => {
    active();
    const input = codexUsageResumeInputSchema.parse(raw);
    return codexUsageTaskSchema.parse(await investigator.resume(input.taskId));
  });
  ipcMain.handle('codex-usage:pause', () => {
    investigator.pause();
  });
  ipcMain.handle('codex-usage:clear', async (_event, raw) => {
    active();
    const input = codexUsageCleanupInputSchema.parse(raw);
    return codexUsageCleanupResultSchema.parse(await investigator.cleanup(input.level));
  });
  ipcMain.handle('codex-usage:export', async (_event, raw) => {
    active();
    const input = codexUsageExportInputSchema.parse(raw);
    const extension = input.format.toLowerCase();
    const selection = await chooseSaveFile({
      defaultPath: defaultExportName(input.format),
      filters: [input.format === 'CSV' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePath) {
      return codexUsageExportResultSchema.parse({ status: 'cancelled' });
    }
    const destination = path.extname(selection.filePath) ? selection.filePath : `${selection.filePath}.${extension}`;
    await investigator.export(input.investigationId, input.format, destination, input.minimumQuotaPercent);
    return codexUsageExportResultSchema.parse({ status: 'exported', fileName: path.basename(destination) });
  });
  queueMicrotask(() => {
    void (async () => {
      try {
        active();
        await investigator.resumeLatest();
      } catch {
        // A disabled extension keeps its checkpoint paused until the user enables it again.
      }
    })();
  });
  return {
    get hasPending() {
      return investigator.hasPending;
    },
    cancel() {
      investigator.pause();
    },
  };
}
