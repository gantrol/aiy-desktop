import { useState } from 'react';
import type {
  CodexUsageTask,
  CodexUsageInvestigation,
  CodexUsageScanInput,
  CodexUsageExportFormat,
} from '@/shared/contracts';
import type { CodexUsageTaskAction } from '@/renderer/features/extensions/CodexUsageTaskControls';

export function useCodexUsageActions({
  authorized,
  selectionBusy,
  task,
  investigation,
  scanInput,
  setTask,
  setError,
  expectCompletedInvestigation,
  cancelExpectedInvestigation,
  notify,
  exportedLabel,
}: {
  authorized: boolean;
  selectionBusy: boolean;
  task: CodexUsageTask | null;
  investigation: CodexUsageInvestigation | null;
  scanInput: CodexUsageScanInput;
  setTask(task: CodexUsageTask): void;
  setError(message: string): void;
  expectCompletedInvestigation(): void;
  cancelExpectedInvestigation(): void;
  notify(message: string): void;
  exportedLabel: string;
}) {
  const [taskAction, setTaskAction] = useState<CodexUsageTaskAction>(null);
  const [exporting, setExporting] = useState<CodexUsageExportFormat | null>(null);
  const controlsLocked = task?.status === 'RUNNING' || taskAction !== null || selectionBusy || Boolean(exporting);
  async function scan(sourceInvestigationId?: string) {
    if (!authorized || controlsLocked) return;
    expectCompletedInvestigation();
    setTaskAction('SCAN');
    setError('');
    try {
      setTask(
        await window.desktopApi.codexUsageScan({
          ...scanInput,
          detailedStatistics: sourceInvestigationId ? true : scanInput.detailedStatistics,
          sourceInvestigationId,
        }),
      );
    } catch (reason) {
      cancelExpectedInvestigation();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTaskAction(null);
    }
  }

  async function pause() {
    if (taskAction !== null) return;
    setTaskAction('PAUSE');
    setError('');
    try {
      await window.desktopApi.codexUsagePause();
    } catch (reason) {
      setTaskAction(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function resume() {
    if (!authorized || controlsLocked || !task || !['PAUSED', 'INTERRUPTED'].includes(task.status)) return;
    expectCompletedInvestigation();
    setTaskAction('RESUME');
    setError('');
    try {
      setTask(await window.desktopApi.codexUsageResume({ taskId: task.taskId }));
    } catch (reason) {
      cancelExpectedInvestigation();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTaskAction(null);
    }
  }

  async function exportReport(format: CodexUsageExportFormat) {
    if (!investigation || exporting || controlsLocked) return;
    setExporting(format);
    setError('');
    try {
      const result = await window.desktopApi.codexUsageExport({
        investigationId: investigation.investigationId,
        format,
        minimumQuotaPercent: investigation.quotaPurity?.minimumQuotaPercent,
      });
      if (result.status === 'exported') notify(`${exportedLabel}: ${result.fileName}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(null);
    }
  }

  return { taskAction, setTaskAction, exporting, controlsLocked, scan, pause, resume, exportReport };
}
