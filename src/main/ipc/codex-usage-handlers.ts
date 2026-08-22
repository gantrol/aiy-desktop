import path from 'node:path';
import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import type { CodexService } from '@/main/assistant/codex-service';
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
import { CODEX_USAGE_INVESTIGATOR_EXTENSION_ID } from '@/shared/extension-ids';

const QUOTA_PERMISSION = 'codex:account-rate-limits';

interface Options {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  codex: CodexService;
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
  codex,
  dataDirectory,
  chooseSaveFile,
  sendRendererEvent,
}: Options): CodexUsageIpcController {
  const investigator = new CodexUsageInvestigator({
    dataDirectory,
    onTaskChanged: (task) => sendRendererEvent('codex-usage:task-changed', codexUsageTaskSchema.parse(task)),
  });
  const active = () => {
    if (!extensions.isActivated(CODEX_USAGE_INVESTIGATOR_EXTENSION_ID)) {
      throw new Error('Did Codex Work Hard Today? is disabled or missing permissions');
    }
  };
  const runOptions = () => ({
    quotaPermissionGranted: extensions.isPermissionGranted(CODEX_USAGE_INVESTIGATOR_EXTENSION_ID, QUOTA_PERMISSION),
    readQuota: codex.readUsageQuota ? (signal: AbortSignal) => codex.readUsageQuota!(signal) : undefined,
  });
  ipcMain.handle('codex-usage:state', () => {
    active();
    return codexUsageStateSchema.parse(investigator.state());
  });
  ipcMain.handle('codex-usage:investigation', (_event, raw) => {
    active();
    const input = codexUsageInvestigationGetInputSchema.parse(raw);
    return codexUsageInvestigationSchema.parse(investigator.investigation(input.investigationId));
  });
  ipcMain.handle('codex-usage:scan', (_event, raw) => {
    active();
    return codexUsageTaskSchema.parse(investigator.start(codexUsageScanInputSchema.parse(raw), runOptions()));
  });
  ipcMain.handle('codex-usage:resume', (_event, raw) => {
    active();
    const input = codexUsageResumeInputSchema.parse(raw);
    return codexUsageTaskSchema.parse(investigator.resume(input.taskId, runOptions()));
  });
  ipcMain.handle('codex-usage:pause', () => {
    investigator.pause();
  });
  ipcMain.handle('codex-usage:clear', (_event, raw) => {
    active();
    const input = codexUsageCleanupInputSchema.parse(raw);
    return codexUsageCleanupResultSchema.parse(investigator.cleanup(input.level));
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
    await investigator.export(input.investigationId, input.format, destination);
    return codexUsageExportResultSchema.parse({ status: 'exported', fileName: path.basename(destination) });
  });
  queueMicrotask(() => {
    try {
      active();
      investigator.resumeLatest(runOptions());
    } catch {
      // A disabled extension keeps its checkpoint paused until the user enables it again.
    }
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
