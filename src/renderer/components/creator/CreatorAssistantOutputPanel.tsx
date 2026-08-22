import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { HistoryIcon, PanelRightCloseIcon } from 'lucide-react';
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
import { Button } from '@/renderer/components/ui/button';
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
  locale,
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
  const recordLabel = locale === 'zh' ? '记录' : 'records';

  if (collapsed) {
    return (
      <section className="relative hidden size-full min-h-0 flex-col items-center bg-secondary pt-3 min-[840px]:flex">
        <CreatorPaneResizeHandle
          edge="left"
          label={locale === 'zh' ? '调整产出区宽度' : 'Resize output'}
          value={resizeValue}
          min={resizeMin}
          max={resizeMax}
          onValueChange={onResizeValueChange}
          onPointerDown={onResizeStart}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={locale === 'zh' ? '展开记录' : 'Expand records'}
          aria-label={locale === 'zh' ? '展开记录' : 'Expand records'}
          onClick={() => onCollapsedChange(false)}
        >
          <HistoryIcon className="size-4" />
        </Button>
      </section>
    );
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-background">
      <CreatorPaneResizeHandle
        edge="left"
        label={locale === 'zh' ? '调整记录区宽度' : 'Resize records'}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <header className="flex h-14 shrink-0 items-center border-b border-border/60 bg-secondary px-3">
        {headerNavigation}
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
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-2 left-2 z-30 hidden shadow-overlay min-[840px]:inline-flex"
        title={locale === 'zh' ? '收起记录区' : `Collapse ${recordLabel}`}
        aria-label={locale === 'zh' ? '收起记录区' : `Collapse ${recordLabel}`}
        onClick={() => onCollapsedChange(true)}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </section>
  );
}
