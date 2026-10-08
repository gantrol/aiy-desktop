import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { CodexUsageState, CodexUsageTask } from '@/shared/contracts';
import type { CodexUsageTaskAction } from '@/renderer/features/extensions/CodexUsageTaskControls';

/** Task completion updates the history, not the report the reader has explicitly chosen. */
export function useCodexUsageTaskState({
  active,
  authorized,
  taskFailed,
  loadInitialInvestigation,
  loadCompletedInvestigation,
  setTask,
  setHistoryState,
  setTaskAction,
  setError,
}: {
  active: boolean;
  authorized: boolean;
  taskFailed: string;
  loadInitialInvestigation(id: string): Promise<void>;
  loadCompletedInvestigation(id: string): Promise<void>;
  setTask: Dispatch<SetStateAction<CodexUsageTask | null>>;
  setHistoryState(state: CodexUsageState): void;
  setTaskAction: Dispatch<SetStateAction<CodexUsageTaskAction>>;
  setError: Dispatch<SetStateAction<string>>;
}) {
  useEffect(() => {
    if (!active || !authorized) return;
    let disposed = false;
    let sequence = 0;
    let taskRevision = 0;
    const failed = (reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    };
    const refresh = async (preferred?: string) => {
      const request = ++sequence;
      const requestedTaskRevision = taskRevision;
      const state = await window.desktopApi.codexUsageState();
      if (disposed || request !== sequence) return;
      if (requestedTaskRevision === taskRevision) setTask(state.task);
      setHistoryState(state);
      const completed = preferred ?? (state.task?.status === 'COMPLETED' ? state.task.investigationId : null);
      if (requestedTaskRevision !== taskRevision) return;
      if (preferred) await loadCompletedInvestigation(preferred);
      else if (completed || state.history[0])
        await loadInitialInvestigation(completed ?? state.history[0].investigationId);
    };
    const unsubscribe = window.desktopApi.onCodexUsageTaskChanged((task) => {
      if (disposed) return;
      taskRevision++;
      setTask(task);
      setTaskAction((current) => (current === 'PAUSE' && task.status === 'RUNNING' ? current : null));
      if (task.status === 'COMPLETED' && task.investigationId) void refresh(task.investigationId).catch(failed);
      if (task.status === 'FAILED') setError(task.errorMessage ?? taskFailed);
    });
    void refresh().catch(failed);
    return () => {
      disposed = true;
      sequence++;
      unsubscribe();
    };
  }, [
    active,
    authorized,
    taskFailed,
    loadInitialInvestigation,
    loadCompletedInvestigation,
    setTask,
    setHistoryState,
    setTaskAction,
    setError,
  ]);
}
