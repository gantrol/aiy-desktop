import type { AssistantRunDto, CodexAssistInput, CreatorAgentScope } from '@/shared/contracts';

interface AssistantRunHistoryInput {
  runs: readonly AssistantRunDto[];
  scope: CreatorAgentScope;
  currentContextKey: string | null;
}

function belongsToScope(run: AssistantRunDto, scope: CreatorAgentScope) {
  return run.scope.kind === scope.kind && run.scope.id === scope.id;
}

function isActive(run: AssistantRunDto) {
  return !run.dismissedAt && !['CLOSED', 'EXPIRED'].includes(run.proposal?.status ?? '');
}

/**
 * Builds the stable history projection for one creator object. Runs are
 * deduplicated only by identity; repeated requests with identical inputs are
 * intentionally retained as separate, auditable experiments.
 */
export function assistantRunHistory({ runs, scope }: AssistantRunHistoryInput): AssistantRunDto[] {
  const byId = new Map<string, AssistantRunDto>();
  for (const run of runs) {
    if (!belongsToScope(run, scope) || byId.has(run.id)) continue;
    byId.set(run.id, run);
  }
  return [...byId.values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/** Keeps repeated inspiration requests novel without replaying old prompts or
 * full assistant results. Only direction labels and axes from the exact frozen
 * editor context become explicit input to the next request. */
export function directionCoverageMemory(
  runs: readonly AssistantRunDto[],
  currentContextKey: string,
  limit = 16,
): NonNullable<CodexAssistInput['previousDirectionCoverage']> {
  const seen = new Set<string>();
  return runs
    .flatMap((run) => {
      if (
        run.mode !== 'directions' ||
        run.status !== 'SUCCEEDED' ||
        run.contextKey !== currentContextKey ||
        !run.proposal
      )
        return [];
      return run.proposal.result.directions.flatMap((direction) => {
        const label = direction.label.trim();
        const variableAxis = direction.variableAxis.trim();
        const signature = `${label.toLocaleLowerCase()}\u0000${variableAxis.toLocaleLowerCase()}`;
        if (!label || !variableAxis || seen.has(signature)) return [];
        seen.add(signature);
        return [{ label, variableAxis }];
      });
    })
    .slice(0, Math.max(0, Math.trunc(limit)));
}

function matchesCurrentContext(run: AssistantRunDto, currentContextKey: string | null) {
  return Boolean(
    currentContextKey &&
    (run.contextKey === currentContextKey || run.proposal?.adoptedContextKey === currentContextKey),
  );
}

/**
 * Keeps accordion behavior deterministic across refreshes: active work wins,
 * then the newest active proposal matching the editor, then the newest active
 * run. Closed records remain in history but do not reopen themselves.
 */
export function defaultExpandedAssistantRunId({
  runs,
  scope,
  currentContextKey,
}: AssistantRunHistoryInput): string | null {
  const history = assistantRunHistory({ runs, scope, currentContextKey });
  return (
    history.find((run) => run.status === 'RUNNING')?.id ??
    history.find((run) => isActive(run) && matchesCurrentContext(run, currentContextKey))?.id ??
    history.find(isActive)?.id ??
    null
  );
}
