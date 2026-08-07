import { useEffect, useMemo, useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import type {
  AssistantActivityEventDto,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssistantWebSearchMode,
  CreatorPromptNodeInput,
  CreatorAgentScope,
  DirectionProposalDto,
} from '@/shared/contracts';
import { assistantRunHistory, defaultExpandedAssistantRunId } from '@/renderer/components/creator/assistantRunHistory';
import {
  CreationCollaborationPanel,
  type CreationAssistantMode,
} from '@/renderer/components/creator/CreationCollaborationPanel';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  scope: CreatorAgentScope | null;
  runs: AssistantRunDto[];
  progressEvents?: AssistantActivityEventDto[];
  prompt: string;
  promptNodes?: CreatorPromptNodeInput[];
  currentContextKey: string | null;
  busy: boolean;
  activeMode: CreationAssistantMode | null;
  error: string;
  showActions?: boolean;
  canRequestIdeas: boolean;
  canBuildPrompt: boolean;
  onRequestIdeas(): void | Promise<void>;
  onBuildPrompt(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
  onApply(run: AssistantRunDto, value: AssistantProposalApplyValue): boolean | void | Promise<boolean | void>;
  onDismiss(run: AssistantRunDto): void | Promise<void>;
  onDismissTransient(): void;
  onStartExperiment(run: AssistantRunDto, directions: DirectionProposalDto[]): void;
}

export function AssistantRunHistoryPanel({
  scope,
  runs,
  progressEvents,
  prompt,
  promptNodes = [],
  currentContextKey,
  busy,
  activeMode,
  error,
  showActions = true,
  canRequestIdeas,
  canBuildPrompt,
  onRequestIdeas,
  onBuildPrompt,
  onApply,
  onDismiss,
  onDismissTransient,
  onStartExperiment,
}: Props) {
  const { locale } = useI18n();
  const history = useMemo(
    () =>
      scope
        ? assistantRunHistory({
            runs,
            scope,
            currentContextKey,
          })
        : [],
    [currentContextKey, runs, scope],
  );
  const preferredExpandedId = useMemo(
    () =>
      scope
        ? defaultExpandedAssistantRunId({
            runs,
            scope,
            currentContextKey,
          })
        : null,
    [currentContextKey, runs, scope],
  );
  const [expandedRunId, setExpandedRunId] = useState<string | null>(busy ? null : preferredExpandedId);
  const newestRunId = history[0]?.id ?? null;

  useEffect(() => {
    setExpandedRunId(busy ? null : preferredExpandedId);
  }, [busy, newestRunId, preferredExpandedId, scope?.id, scope?.kind]);

  return (
    <section data-assistant-history aria-label="Agent">
      {(showActions || busy || Boolean(error)) && (
        <CreationCollaborationPanel
          prompt={prompt}
          promptNodes={promptNodes}
          basePrompt={null}
          assistantRun={null}
          progressEvents={progressEvents}
          currentContextKey={currentContextKey}
          busy={busy}
          activeMode={activeMode}
          error={error}
          canRequestIdeas={canRequestIdeas}
          canBuildPrompt={canBuildPrompt}
          showActions={showActions}
          className={showActions ? undefined : 'mt-3'}
          onRequestIdeas={onRequestIdeas}
          onBuildPrompt={onBuildPrompt}
          onApply={() => undefined}
          onDismiss={onDismissTransient}
        />
      )}
      {history.length > 0 && (
        <div
          className="mt-3 flex items-center gap-1.5 px-1 text-xs font-semibold text-foreground-secondary"
          data-assistant-history-heading
        >
          <HistoryIcon className="size-3.5" aria-hidden="true" />
          <span>{locale === 'zh' ? '历史记录' : 'History'}</span>
          <span className="font-normal tabular-nums text-muted-foreground">{history.length}</span>
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-2 space-y-2" data-assistant-history-list>
          {history.map((run) => (
            <CreationCollaborationPanel
              key={run.id}
              prompt={prompt}
              promptNodes={promptNodes}
              basePrompt={run.input.prompt}
              assistantRun={run}
              progressEvents={run.activityEvents}
              currentContextKey={currentContextKey}
              busy={false}
              activeMode={null}
              error=""
              canRequestIdeas={false}
              canBuildPrompt={false}
              showActions={false}
              open={expandedRunId === run.id}
              onOpenChange={(open) =>
                setExpandedRunId(open ? run.id : (current) => (current === run.id ? null : current))
              }
              onRequestIdeas={() => undefined}
              onBuildPrompt={() => undefined}
              onApply={(value) => onApply(run, value)}
              onDismiss={() => {
                setExpandedRunId((current) => (current === run.id ? null : current));
                void onDismiss(run);
              }}
              onStartExperiment={(directions) => onStartExperiment(run, directions)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
