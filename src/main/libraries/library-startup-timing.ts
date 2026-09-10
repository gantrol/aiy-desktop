import type { DatabaseStartupCheck } from '@/main/database/core/database-shutdown-state';

type LibraryStartupStage =
  'openDatabase' | 'initializeDatabase' | 'connectServices' | 'loadExtensions' | 'applySettings' | 'createContext';

export function createLibraryStartupTiming() {
  const startedAt = performance.now();
  let stageStartedAt = startedAt;
  const stagesMs: Partial<Record<LibraryStartupStage, number>> = {};
  return {
    finishStage(stage: LibraryStartupStage) {
      const finishedAt = performance.now();
      stagesMs[stage] = Math.round(finishedAt - stageStartedAt);
      stageStartedAt = finishedAt;
    },
    logReady(libraryId: string, databaseCheck: DatabaseStartupCheck) {
      console.info('[local-space] context ready', {
        libraryId,
        durationMs: Math.round(performance.now() - startedAt),
        stagesMs,
        databaseCheck,
      });
    },
  };
}
