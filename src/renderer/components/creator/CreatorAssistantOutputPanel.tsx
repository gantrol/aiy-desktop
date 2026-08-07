import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ArchiveIcon,
  CircleAlertIcon,
  FilePenLineIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  PanelRightCloseIcon,
} from 'lucide-react';
import type {
  AssistantActivityEventDto,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssistantWebSearchMode,
  CreationDto,
  CreatorAgentScope,
  CreatorPromptNodeInput,
  DirectionProposalDto,
  Locale,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { AssistantRunHistoryPanel } from '@/renderer/components/creator/AssistantRunHistoryPanel';
import type { CreationAssistantMode } from '@/renderer/components/creator/CreationCollaborationPanel';
import { CreationOutputTabs, type CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';

interface Props {
  mode: Extract<CreationOutputMode, 'ideas' | 'writing'>;
  locale: Locale;
  creation: CreationDto | null;
  ideasDisabled: boolean;
  writingDisabled: boolean;
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
  onModeChange(mode: CreationOutputMode): void;
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

function ideaStatus(creation: CreationDto | null, running: boolean, locale: Locale) {
  if (running || creation?.status === 'FORMING') {
    return {
      label: locale === 'zh' ? '草稿 · 生成中' : 'Draft · Generating',
      tone: 'info' as const,
      icon: <LoaderCircleIcon className="animate-spin" />,
    };
  }
  if (creation?.status === 'FAILED') {
    return {
      label: locale === 'zh' ? '草稿有错误' : 'Draft error',
      tone: 'danger' as const,
      icon: <CircleAlertIcon />,
    };
  }
  if (creation?.status === 'ARCHIVED') {
    return {
      label: locale === 'zh' ? '已归档' : 'Archived',
      tone: 'neutral' as const,
      icon: <ArchiveIcon />,
    };
  }
  return {
    label: locale === 'zh' ? '草稿' : 'Draft',
    tone: 'neutral' as const,
    icon: <LightbulbIcon />,
  };
}

export function CreatorAssistantOutputPanel({
  mode,
  locale,
  creation,
  ideasDisabled,
  writingDisabled,
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
  onModeChange,
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
  const status = ideaStatus(creation, busy, locale);
  const modeLabel = mode === 'ideas' ? (locale === 'zh' ? '灵感' : 'Ideas') : locale === 'zh' ? '帮写' : 'Writing';

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
          title={locale === 'zh' ? `展开${modeLabel}` : `Expand ${modeLabel}`}
          aria-label={locale === 'zh' ? `展开${modeLabel}` : `Expand ${modeLabel}`}
          onClick={() => onCollapsedChange(false)}
        >
          {mode === 'ideas' ? <LightbulbIcon className="size-4" /> : <FilePenLineIcon className="size-4" />}
        </Button>
      </section>
    );
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-background">
      <CreatorPaneResizeHandle
        edge="left"
        label={locale === 'zh' ? '调整产出区宽度' : 'Resize output'}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-secondary px-3">
        <CreationOutputTabs
          value={mode}
          locale={locale}
          ideasDisabled={ideasDisabled}
          writingDisabled={writingDisabled}
          onValueChange={onModeChange}
        />
        {mode === 'ideas' && (creation || busy) && (
          <StateTag tone={status.tone} icon={status.icon}>
            {status.label}
          </StateTag>
        )}
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
        title={locale === 'zh' ? '收起产出区' : 'Collapse output'}
        aria-label={locale === 'zh' ? '收起产出区' : 'Collapse output'}
        onClick={() => onCollapsedChange(true)}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </section>
  );
}
