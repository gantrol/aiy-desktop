import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  Clock3Icon,
  EyeOffIcon,
  FilePenLineIcon,
  FlaskConicalIcon,
  GitBranchPlusIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AssistantActivityEventDto,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssistantWebSearchMode,
  CreatorPromptNodeInput,
  DirectionProposalDto,
} from '@/shared/contracts';
import { AgentRobotIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { AssistantWritingAction } from '@/renderer/components/creator/AssistantWritingAction';
import { AssistantProgressTimeline } from '@/renderer/components/creator/AssistantProgressTimeline';
import { PromptTextProposal } from '@/renderer/components/creator/PromptTextProposal';

export type CreationAssistantMode = 'directions' | 'optimize';

interface Props {
  prompt: string;
  promptNodes?: CreatorPromptNodeInput[];
  basePrompt: string | null;
  assistantRun?: AssistantRunDto | null;
  progressEvents?: AssistantActivityEventDto[];
  currentContextKey?: string | null;
  busy: boolean;
  activeMode: CreationAssistantMode | null;
  error: string;
  canRequestIdeas: boolean;
  canBuildPrompt: boolean;
  selectedDirectionIndexes?: number[];
  showActions?: boolean;
  dismissible?: boolean;
  showCreationTitle?: boolean;
  open?: boolean;
  className?: string;
  onOpenChange?(open: boolean): void;
  onRequestIdeas(): void | Promise<void>;
  onBuildPrompt(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
  onApply(value: AssistantProposalApplyValue): boolean | void | Promise<boolean | void>;
  onDismiss(): void;
  onSelectionChange?(indexes: number[]): void;
  onStartExperiment?(directions: DirectionProposalDto[]): void;
}

const extraCopy = {
  en: {
    contextReceipt: 'Frozen input',
    terms: 'terms',
    candidateTerms: 'candidate terms',
    recipes: 'recipes',
    references: 'references',
    visionNotAnalyzed: 'Images were not analyzed',
    sharedConstraints: 'Keep fixed',
    assumptions: 'Assumptions to verify',
    promptChanges: 'Structured changes',
    preserved: 'Preserved',
    removed: 'Removed',
    before: 'Before',
    after: 'After',
    applyChange: 'Apply this change',
    removeItem: 'Accept removal',
    changeApplied: 'Applied',
    proposalAdopted: 'Proposal adopted',
    promptDraft: 'Prompt draft',
    addedTerms: 'Added terms',
    removedTerms: 'Removed terms',
    warnings: 'Check before applying',
    variableAxis: 'Only variable',
    risk: 'Risk',
    selectDirections: 'Select directions to compare',
    startExperiment: (count: number) => `Try ${count} ${count === 1 ? 'direction' : 'directions'}`,
    expand: 'Expand Agent proposal',
    collapse: 'Collapse Agent proposal',
    directionsMode: 'Creative directions',
    adjacentMode: 'Adjacent directions',
    optimizeMode: 'AI writing',
    searchOptimizeMode: 'Search + optimize',
    ready: 'Ready',
    creation: 'Creation',
    expired: 'Expired',
  },
  zh: {
    candidateTerms: '个候选词条',
    promptDraft: 'Prompt 草稿',
    addedTerms: '新增词条',
    removedTerms: '移除词条',
    warnings: '采用前确认',
    contextReceipt: '已冻结输入',
    terms: '个词条',
    recipes: '个配方',
    references: '个参考',
    visionNotAnalyzed: '未分析图片内容',
    sharedConstraints: '共同保持项',
    assumptions: '待确认假设',
    promptChanges: '结构化差异',
    preserved: '保留',
    removed: '删除',
    before: '原文',
    after: '建议',
    applyChange: '应用此项',
    removeItem: '接受删除',
    changeApplied: '已应用',
    proposalAdopted: '提案已采用',
    variableAxis: '唯一变化轴',
    risk: '风险',
    selectDirections: '选择要比较的方向',
    startExperiment: (count: number) => `试这 ${count} 个方向`,
    expand: '展开 Agent 提案',
    collapse: '收起 Agent 提案',
    directionsMode: '灵感方向',
    adjacentMode: '相邻方向',
    optimizeMode: 'AI帮写',
    searchOptimizeMode: '搜索 + 优化',
    ready: '可采用',
    creation: '创作',
    expired: '已过期',
  },
} as const;

function promptNodeSignature(nodes: readonly CreatorPromptNodeInput[]) {
  return JSON.stringify(nodes.map((node) => (node.kind === 'TEXT' ? { ...node, text: node.text.trim() } : node)));
}

export function CreationCollaborationPanel({
  prompt,
  promptNodes = [],
  basePrompt,
  assistantRun = null,
  progressEvents,
  currentContextKey = null,
  busy,
  activeMode,
  error,
  canRequestIdeas,
  canBuildPrompt,
  selectedDirectionIndexes,
  showActions = true,
  dismissible = true,
  showCreationTitle = true,
  open,
  className,
  onOpenChange,
  onRequestIdeas,
  onBuildPrompt,
  onApply,
  onDismiss,
  onSelectionChange,
  onStartExperiment,
}: Props) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.starter;
  const copy = extraCopy[locale];
  const result = assistantRun?.proposal?.result;
  const visibleProgress = progressEvents ?? assistantRun?.activityEvents ?? [];
  const adjacentProposal = Boolean(assistantRun?.input.sourceExperimentSlotId);
  const [uncontrolledSelection, setUncontrolledSelection] = useState<number[]>([]);
  const [applyingPrompt, setApplyingPrompt] = useState(false);
  const [detailOpen, setDetailOpen] = useState(
    () =>
      !assistantRun ||
      assistantRun.status === 'RUNNING' ||
      assistantRun.status === 'FAILED' ||
      assistantRun.status === 'INTERRUPTED' ||
      !assistantRun.proposal ||
      assistantRun.proposal.status === 'READY',
  );
  const directionSignature = result?.directions.map((direction) => direction.prompt).join('\u0000') ?? '';

  useEffect(() => {
    if (selectedDirectionIndexes === undefined) setUncontrolledSelection([]);
  }, [assistantRun?.id, directionSignature, selectedDirectionIndexes]);

  const selection = (selectedDirectionIndexes ?? uncontrolledSelection)
    .filter(
      (index, position, values) =>
        index >= 0 && index < (result?.directions.length ?? 0) && values.indexOf(index) === position,
    )
    .sort((left, right) => left - right);
  const normalizedPrompt = prompt.trim();
  const proposalPrompts = [
    result?.optimizedPrompt,
    result?.promptEdit?.revisedUserInstruction,
    ...(result?.directions.map((direction) => direction.prompt) ?? []),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const draftPromptNodes =
    result?.promptDraft?.contentNodes.map((node): CreatorPromptNodeInput =>
      node.kind === 'TEXT'
        ? { kind: 'TEXT', text: node.text }
        : node.kind === 'TERM'
          ? { kind: 'TERM', termId: node.termId }
          : { kind: 'RECIPE', paletteId: node.paletteId },
    ) ?? [];
  const proposalApplied = result?.promptDraft
    ? promptNodeSignature(promptNodes) === promptNodeSignature(draftPromptNodes)
    : proposalPrompts.includes(normalizedPrompt);
  const contextChanged = Boolean(
    assistantRun &&
    !assistantRun.input.sourceExperimentSlotId &&
    currentContextKey &&
    assistantRun.contextKey !== currentContextKey &&
    assistantRun.proposal?.adoptedContextKey !== currentContextKey,
  );
  const persistedExpired = assistantRun?.proposal?.status === 'EXPIRED';
  const promptChanged = Boolean(result && basePrompt !== null && prompt !== basePrompt);
  const stale = assistantRun ? persistedExpired || contextChanged : !proposalApplied && promptChanged;
  const suggestedPrompt = (result?.promptEdit?.revisedUserInstruction || result?.optimizedPrompt || '').trim();
  const showSuggestedPrompt = Boolean(
    !result?.promptDraft && suggestedPrompt && suggestedPrompt !== basePrompt?.trim(),
  );
  const directions = result?.directions ?? [];
  const hasPromptEdit = Boolean(
    !result?.promptDraft &&
    result?.promptEdit &&
    (result.promptEdit.summary.trim() ||
      result.promptEdit.preserved.length ||
      result.promptEdit.changes.length ||
      result.promptEdit.removed.length),
  );
  const hasStructuredResult = Boolean(
    result &&
    (result.promptDraft?.contentNodes.length ||
      hasPromptEdit ||
      result.sharedConstraints?.length ||
      result.assumptions?.length),
  );
  const hasResult = Boolean(
    result && (result.assistantMessage.trim() || showSuggestedPrompt || directions.length || hasStructuredResult),
  );
  const originalTermNames = new Map(assistantRun?.input.directTerms.map((term) => [term.stableId, term.displayName]));
  const draftTermIds = new Set(
    result?.promptDraft?.contentNodes.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : [])) ?? [],
  );
  const addedTerms =
    result?.promptDraft?.contentNodes.filter((node) => node.kind === 'TERM' && !originalTermNames.has(node.termId)) ??
    [];
  const removedTerms = [...originalTermNames.entries()].filter(([termId]) => !draftTermIds.has(termId));
  const effectiveBusy = busy || assistantRun?.status === 'RUNNING';
  const effectiveMode = assistantRun?.status === 'RUNNING' ? assistantRun.mode : activeMode;
  const effectiveError =
    error || (assistantRun && ['FAILED', 'INTERRUPTED'].includes(assistantRun.status) ? assistantRun.errorMessage : '');
  const showDetail = effectiveBusy || Boolean(effectiveError) || hasResult || Boolean(assistantRun);
  const expanded = open ?? detailOpen;

  useEffect(() => {
    setDetailOpen(
      !assistantRun ||
        assistantRun.status === 'RUNNING' ||
        assistantRun.status === 'FAILED' ||
        assistantRun.status === 'INTERRUPTED' ||
        !assistantRun.proposal ||
        assistantRun.proposal.status === 'READY',
    );
  }, [assistantRun?.id, assistantRun?.status, assistantRun?.proposal?.status]);

  function changeSelection(next: number[]) {
    const normalized = [...new Set(next)].sort((left, right) => left - right);
    if (selectedDirectionIndexes === undefined) setUncontrolledSelection(normalized);
    onSelectionChange?.(normalized);
  }

  function toggleDirection(index: number, checked: boolean) {
    changeSelection(checked ? [...selection, index] : selection.filter((item) => item !== index));
  }

  function startExperiment() {
    if (stale) return;
    onStartExperiment?.(selection.flatMap((index) => directions[index] ?? []));
  }

  async function applyValue(value: AssistantProposalApplyValue) {
    if (applyingPrompt) return false;
    setApplyingPrompt(true);
    try {
      return await onApply(value);
    } finally {
      setApplyingPrompt(false);
    }
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(next) => {
        setDetailOpen(next);
        onOpenChange?.(next);
      }}
      asChild
    >
      <section
        data-creation-collaboration
        data-assistant-run-id={assistantRun?.id}
        className={cn('overflow-hidden rounded-xl border bg-surface', showActions && 'mt-3', className)}
        aria-label={labels.collaborationTitle}
      >
        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-foreground-secondary"
            aria-hidden="true"
          >
            {showActions ? (
              <AgentRobotIcon className="size-4" />
            ) : effectiveBusy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : !assistantRun && !effectiveMode ? (
              <AgentRobotIcon className="size-4" />
            ) : adjacentProposal ? (
              <GitBranchPlusIcon className="size-4" />
            ) : assistantRun?.mode === 'directions' ? (
              <LightbulbIcon className="size-4" />
            ) : (
              <FilePenLineIcon className="size-4" />
            )}
          </span>
          {showActions ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canRequestIdeas || effectiveBusy}
                onClick={() => void onRequestIdeas()}
              >
                {effectiveBusy && effectiveMode === 'directions' ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <LightbulbIcon className="size-4" />
                )}
                {labels.ideas}
              </Button>
              <AssistantWritingAction
                variant="outline"
                disabled={!canBuildPrompt || effectiveBusy}
                busy={effectiveBusy && effectiveMode === 'optimize'}
                label={labels.buildPrompt}
                searchLabel={labels.searchAndOptimize}
                optionsLabel={labels.writingOptions}
                onRun={onBuildPrompt}
              />
            </>
          ) : assistantRun ? (
            <>
              <span className="text-xs font-semibold">
                {adjacentProposal
                  ? copy.adjacentMode
                  : assistantRun.mode === 'directions'
                    ? copy.directionsMode
                    : assistantRun.input.webSearchMode === 'REQUIRED'
                      ? copy.searchOptimizeMode
                      : copy.optimizeMode}
              </span>
              <time className="text-2xs tabular-nums text-muted-foreground" dateTime={assistantRun.createdAt}>
                {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(assistantRun.createdAt))}
              </time>
            </>
          ) : (
            <span className="text-xs font-semibold">
              {effectiveMode === 'directions'
                ? copy.directionsMode
                : effectiveMode === 'optimize'
                  ? copy.optimizeMode
                  : labels.collaborationTitle}
            </span>
          )}
          {showCreationTitle && assistantRun?.creationTitle && (
            <span className="max-w-48 truncate text-2xs text-muted-foreground">
              {copy.creation} · {assistantRun.creationTitle}
            </span>
          )}
          {persistedExpired && (
            <StateTag className="ml-auto" tone="neutral" icon={<Clock3Icon />}>
              {copy.expired}
            </StateTag>
          )}
          {!persistedExpired && contextChanged && (
            <StateTag className="ml-auto" tone="warning" icon={<CircleAlertIcon />}>
              {labels.staleProposal}
            </StateTag>
          )}
          {!stale && assistantRun?.proposal?.status === 'ADOPTED' && (
            <StateTag className="ml-auto" tone="success" icon={<CheckIcon />}>
              {copy.proposalAdopted}
            </StateTag>
          )}
          {!stale && assistantRun?.proposal?.status === 'READY' && (
            <StateTag className="ml-auto" tone="info" icon={<CheckIcon />}>
              {copy.ready}
            </StateTag>
          )}
          {showDetail && (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={
                  stale || ['ADOPTED', 'READY'].includes(assistantRun?.proposal?.status ?? '') ? '' : 'ml-auto'
                }
                title={expanded ? copy.collapse : copy.expand}
                aria-label={expanded ? copy.collapse : copy.expand}
              >
                <ChevronDownIcon className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          )}
          {showDetail && dismissible && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={labels.dismissProposal}
              aria-label={labels.dismissProposal}
              disabled={effectiveBusy}
              onClick={onDismiss}
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>

        {showDetail && (
          <CollapsibleContent asChild>
            <div className="border-t bg-surface-sunken/25 px-4 py-4" aria-live="polite">
              <AssistantProgressTimeline events={visibleProgress} locale={locale} running={effectiveBusy} />
              {assistantRun && (
                <div
                  data-assistant-capability-receipt
                  className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2 text-2xs text-muted-foreground"
                >
                  <strong className="text-foreground-secondary">{copy.contextReceipt}</strong>
                  <span>
                    {assistantRun.capabilityReceipt.directTermCount} {copy.terms}
                  </span>
                  {(assistantRun.capabilityReceipt.candidateTermCount ?? 0) > 0 && (
                    <span>
                      {assistantRun.capabilityReceipt.candidateTermCount} {copy.candidateTerms}
                    </span>
                  )}
                  <span>
                    {assistantRun.capabilityReceipt.recipeCount} {copy.recipes}
                  </span>
                  <span>
                    {assistantRun.capabilityReceipt.referenceCount} {copy.references}
                  </span>
                  {!assistantRun.capabilityReceipt.visionAnalyzed && (
                    <span className="ml-auto inline-flex items-center gap-1 font-medium text-warning">
                      <EyeOffIcon className="size-3.5" />
                      {copy.visionNotAnalyzed}
                    </span>
                  )}
                </div>
              )}
              {effectiveBusy ? (
                <div className="flex min-h-12 items-center gap-3 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  <span>{effectiveMode === 'directions' ? labels.exploringDirections : labels.organizingPrompt}</span>
                </div>
              ) : effectiveError ? (
                <div className="rounded-lg border border-destructive bg-destructive-surface px-3 py-2 text-xs text-destructive">
                  {effectiveError}
                </div>
              ) : (
                <div className="space-y-4">
                  {result?.assistantMessage && <p className="text-sm leading-relaxed">{result.assistantMessage}</p>}

                  {(result?.sharedConstraints?.length ?? 0) > 0 && (
                    <section aria-label={copy.sharedConstraints}>
                      <strong className="text-xs">{copy.sharedConstraints}</strong>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {result?.sharedConstraints.map((constraint, index) => (
                          <span
                            key={`${constraint}:${index}`}
                            className="rounded-full border bg-background px-2 py-1 text-xs"
                          >
                            {constraint}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {(result?.assumptions?.length ?? 0) > 0 && (
                    <section aria-label={copy.assumptions}>
                      <strong className="text-xs">{copy.assumptions}</strong>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {result?.assumptions.map((assumption, index) => (
                          <article key={`${assumption.label}:${index}`} className="rounded-lg border bg-background p-3">
                            <div className="text-xs font-semibold">{assumption.label}</div>
                            <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">
                              {assumption.interpretation}
                            </p>
                            <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{assumption.impact}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <PromptTextProposal
                    prompt={prompt}
                    promptEdit={hasPromptEdit ? result?.promptEdit : undefined}
                    optimizedPrompt={suggestedPrompt}
                    showOptimizedPrompt={showSuggestedPrompt}
                    proposalApplied={proposalApplied}
                    stale={stale}
                    applying={applyingPrompt}
                    copy={{
                      promptChanges: copy.promptChanges,
                      preserved: copy.preserved,
                      removed: copy.removed,
                      before: copy.before,
                      after: copy.after,
                      applyChange: copy.applyChange,
                      removeItem: copy.removeItem,
                      changeApplied: copy.changeApplied,
                      promptProposal: labels.promptProposal,
                      proposalApplied: labels.proposalApplied,
                    }}
                    onApply={applyValue}
                  />

                  {result?.promptDraft && (
                    <article data-prompt-draft-proposal className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <FilePenLineIcon className="size-4 text-muted-foreground" />
                          <strong className="text-xs">{copy.promptDraft}</strong>
                        </div>
                        {proposalApplied && !stale ? (
                          <span className="flex items-center gap-1 text-xs text-success">
                            <CheckIcon className="size-3.5" />
                            {labels.proposalApplied}
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            disabled={stale || applyingPrompt}
                            onClick={() => void applyValue({ kind: 'PROMPT_DRAFT', draft: result.promptDraft! })}
                          >
                            {applyingPrompt ? (
                              <LoaderCircleIcon className="size-3.5 animate-spin" />
                            ) : (
                              <ArrowRightIcon className="size-3.5" />
                            )}
                            {labels.applyProposal}
                          </Button>
                        )}
                      </div>
                      {result.promptDraft.summary && (
                        <p className="mt-2 text-xs leading-relaxed text-foreground-secondary">
                          {result.promptDraft.summary}
                        </p>
                      )}
                      {(addedTerms.length > 0 || removedTerms.length > 0) && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {addedTerms.length > 0 && (
                            <div>
                              <span className="text-2xs font-medium text-muted-foreground">{copy.addedTerms}</span>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {addedTerms.map((node) => (
                                  <span
                                    key={node.kind === 'TERM' ? node.termId : ''}
                                    className="rounded-sm bg-success-surface px-1.5 py-0.5 text-2xs text-success"
                                  >
                                    {node.kind === 'TERM' ? node.displayName : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {removedTerms.length > 0 && (
                            <div>
                              <span className="text-2xs font-medium text-muted-foreground">{copy.removedTerms}</span>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {removedTerms.map(([termId, displayName]) => (
                                  <span
                                    key={termId}
                                    className="rounded-sm bg-destructive-surface px-1.5 py-0.5 text-2xs text-destructive line-through"
                                  >
                                    {displayName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md bg-surface-sunken p-2">
                        {result.promptDraft.contentNodes.map((node, index) =>
                          node.kind === 'TEXT' ? (
                            <span key={`text:${index}`} className="whitespace-pre-wrap text-xs leading-relaxed">
                              {node.text}
                            </span>
                          ) : (
                            <span
                              key={`${node.kind}:${node.kind === 'TERM' ? node.termId : node.paletteId}`}
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs font-medium',
                                node.kind === 'TERM'
                                  ? 'border-success/30 bg-success-surface text-success'
                                  : 'border-warning/30 bg-warning-surface text-warning',
                              )}
                            >
                              {node.displayName}
                            </span>
                          ),
                        )}
                      </div>
                      {result.promptDraft.warnings.length > 0 && (
                        <div className="mt-3 rounded-md border border-warning/30 bg-warning-surface px-2.5 py-2">
                          <span className="text-2xs font-semibold text-warning">{copy.warnings}</span>
                          <ul className="mt-1 space-y-1 text-xs text-foreground-secondary">
                            {result.promptDraft.warnings.map((warning, index) => (
                              <li key={`${warning}:${index}`}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </article>
                  )}

                  {directions.length > 0 && (
                    <section aria-label={copy.selectDirections}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-xs">
                          {onStartExperiment ? copy.selectDirections : labels.chooseDirection}
                        </strong>
                        {onStartExperiment && (
                          <Button
                            type="button"
                            size="xs"
                            disabled={selection.length === 0 || stale}
                            onClick={startExperiment}
                          >
                            <FlaskConicalIcon className="size-3.5" />
                            {copy.startExperiment(selection.length)}
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {directions.map((direction, index) => {
                          const applied = normalizedPrompt === direction.prompt.trim();
                          const selected = selection.includes(index);
                          return (
                            <article
                              key={`${direction.label}:${index}`}
                              data-direction-selected={selected || undefined}
                              className={cn(
                                'flex min-h-44 flex-col rounded-lg border bg-background p-3 transition-colors',
                                selected && 'border-selected-border bg-selected text-selected-foreground',
                              )}
                            >
                              <div className="flex items-start gap-2">
                                {onStartExperiment ? (
                                  <Checkbox
                                    aria-label={`${copy.selectDirections}: ${direction.label}`}
                                    checked={selected}
                                    onCheckedChange={(checked) => toggleDirection(index, checked === true)}
                                  />
                                ) : (
                                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-2xs font-medium">
                                    {applied ? <CheckIcon className="size-3.5" /> : index + 1}
                                  </span>
                                )}
                                <strong className="text-sm">{direction.label}</strong>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {direction.rationale}
                              </p>
                              {direction.variableAxis && (
                                <div className="mt-3 text-xs">
                                  <span className="text-2xs font-medium text-muted-foreground">
                                    {copy.variableAxis}
                                  </span>
                                  <p className="mt-0.5">{direction.variableAxis}</p>
                                </div>
                              )}
                              {direction.risk && (
                                <div className="mt-2 text-xs">
                                  <span className="text-2xs font-medium text-warning">{copy.risk}</span>
                                  <p className="mt-0.5 text-muted-foreground">{direction.risk}</p>
                                </div>
                              )}
                              {applied ? (
                                <span className="mt-auto flex items-center gap-1 pt-3 text-2xs font-medium text-success">
                                  <CheckIcon className="size-3" />
                                  {labels.proposalApplied}
                                </span>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="mt-auto self-start px-0 pt-3 hover:bg-transparent"
                                  disabled={stale || applyingPrompt}
                                  onClick={() => void applyValue({ kind: 'PROMPT_TEXT', prompt: direction.prompt })}
                                >
                                  {labels.useDirection}
                                  <ArrowRightIcon className="size-3" />
                                </Button>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </section>
    </Collapsible>
  );
}
