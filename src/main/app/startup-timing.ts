type StartupStage =
  'loadMainModule' | 'electronReady' | 'hostSetup' | 'libraryInit' | 'contextActivation' | 'registerIpc';

const stagesMs: Partial<Record<StartupStage, number>> = {};
let previousMs = 0;

export function finishStartupStage(stage: StartupStage) {
  const currentMs = process.uptime() * 1000;
  stagesMs[stage] = Math.round(currentMs - previousMs);
  previousMs = currentMs;
}

export function startupTimingDetails() {
  const previewStartedAt = Number(process.env.AIY_PREVIEW_STARTED_AT);
  return {
    processUptimeMs: Math.round(process.uptime() * 1000),
    ...(Number.isFinite(previewStartedAt) && previewStartedAt > 0 && previewStartedAt <= Date.now()
      ? { previewToWindowMs: Date.now() - previewStartedAt }
      : {}),
    stagesMs: { ...stagesMs },
  };
}
