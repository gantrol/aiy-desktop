import type { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import type { CodexUsageTask } from '@/shared/contracts/codex-usage';

export type UsageWorkerMethod =
  'state' | 'investigation' | 'start' | 'resume' | 'resumeLatest' | 'pause' | 'cleanup' | 'export';
export type UsageWorkerRequest = {
  [K in UsageWorkerMethod]: { id: number; method: K; args: Parameters<CodexUsageInvestigator[K]> };
}[UsageWorkerMethod];
export type UsageWorkerResponse =
  { kind: 'task'; task: CodexUsageTask } | { kind: 'result'; id: number; value?: unknown; error?: string };
