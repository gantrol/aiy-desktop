import { useI18n } from '@/renderer/i18n/useI18n';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type {
  AssistantActivityEventDto,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssistantWebSearchMode,
  CreatorAgentScope,
  CreatorPromptNodeInput,
  DirectionProposalDto,
  Locale,
} from '@/shared/contracts';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { AssistantRunHistoryPanel } from '@/renderer/components/creator/AssistantRunHistoryPanel';
import type { CreationAssistantMode } from '@/renderer/components/creator/CreationCollaborationPanel';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';

interface Props {
  headerNavigation: ReactNode;
  locale: Locale;
  scope: CreatorAgentScope | null;
  runs: AssistantRunDto[];
  progressEvents?: AssistantActivityEventDto[];
  prompt: string;
  promptNodes: CreatorPromptNodeInput[];
  currentContextKey: string | null;
  busy: boolean;
  activeMode: CreationAssistantMode | null;
  error: string;
  collapsed: boolean;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
  onCollapsedChange(collapsed: boolean): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeValueChange(value: number): void;
  onRequestIdeas(): void | Promise<void>;
  onBuildPrompt(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
  onApply(run: AssistantRunDto, value: AssistantProposalApplyValue): boolean | void | Promise<boolean | void>;
  onDismiss(run: AssistantRunDto): void | Promise<void>;
  onDismissTransient(): void;
  onStartExperiment(run: AssistantRunDto, directions: DirectionProposalDto[]): void;
}

export function CreatorRecordPanel({
  headerNavigation,
  scope,
  runs,
  progressEvents,
  prompt,
  promptNodes,
  currentContextKey,
  busy,
  activeMode,
  error,
  collapsed,
  resizeValue,
  resizeMin,
  resizeMax,
  onCollapsedChange,
  onResizeStart,
  onResizeValueChange,
  onRequestIdeas,
  onBuildPrompt,
  onApply,
  onDismiss,
  onDismissTransient,
  onStartExperiment,
}: Props) {
  const { messages } = useI18n();

  if (collapsed) {
    return (
      <section
        data-workbench-pane
        className="relative hidden size-full min-h-0 flex-col bg-secondary @min-[840px]/creator:flex"
      >
        <CreatorPaneResizeHandle
          edge="left"
          label={messages.workbench.resizePane(messages.workbench.records)}
          value={resizeValue}
          min={resizeMin}
          max={resizeMax}
          onValueChange={onResizeValueChange}
          onPointerDown={onResizeStart}
        />
        <WorkbenchPaneToggle
          expanded={false}
          side="right"
          label={messages.workbench.records}
          onClick={() => onCollapsedChange(false)}
        />
      </section>
    );
  }

  return (
    <section data-workbench-pane className="relative flex min-h-0 min-w-0 flex-col bg-background">
      <CreatorPaneResizeHandle
        edge="left"
        label={messages.workbench.resizePane(messages.workbench.records)}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <header className="flex h-14 shrink-0 items-center border-b border-border/60 bg-secondary px-3">
        {headerNavigation}
        <WorkbenchPaneToggle
          expanded
          floating={false}
          side="right"
          label={messages.workbench.records}
          className="ml-auto hidden @min-[840px]/creator:inline-flex"
          onClick={() => onCollapsedChange(true)}
        />
      </header>
      <ScrollArea type="always" className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          <AssistantRunHistoryPanel
            scope={scope}
            runs={runs}
            progressEvents={progressEvents}
            prompt={prompt}
            promptNodes={promptNodes}
            currentContextKey={currentContextKey}
            busy={busy}
            activeMode={activeMode}
            error={error}
            showActions={false}
            canRequestIdeas={false}
            canBuildPrompt={false}
            onRequestIdeas={onRequestIdeas}
            onBuildPrompt={onBuildPrompt}
            onApply={onApply}
            onDismiss={onDismiss}
            onDismissTransient={onDismissTransient}
            onStartExperiment={onStartExperiment}
          />
        </div>
      </ScrollArea>
    </section>
  );
}
