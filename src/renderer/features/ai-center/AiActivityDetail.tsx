import { useState } from 'react';
import { ImageIcon, PencilLineIcon, RotateCcwIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import type { BootstrapDto, Locale, StyleExplorationSlotDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { AssistantProgressTimeline } from '@/renderer/components/creator/AssistantProgressTimeline';
import { GenerationErrorNotice } from '@/renderer/components/generation/GenerationErrorNotice';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiActivityStatusTag } from '@/renderer/features/ai-center/AiActivityStatusTag';
import type {
  AiActivityRecord,
  AssistantActivityRecord,
  ExperimentActivityRecord,
  GenerationActivityRecord,
} from '@/renderer/features/ai-center/activityProjection';

interface Props {
  record: AiActivityRecord | null;
  data: BootstrapDto;
  locale: Locale;
  canLocate: boolean;
  onLocate(record: AiActivityRecord): void;
  onReEditGeneration(runId: string): void;
  onRetryGeneration(runId: string): Promise<void>;
  onRetrySlot(slotId: string): Promise<void>;
  notify(message: string): void;
}

function localizedSeriesTitle(record: AiActivityRecord, _locale: Locale, fallback: string) {
  if (!record.sourceSeries) return fallback;
  return record.sourceSeries.title;
}

function dateTime(value: string | null, locale: Locale) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function Fact({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 truncate font-mono text-xs' : 'mt-1 text-xs'}>{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5 border-t pt-4">
      <h3 className="text-xs font-semibold text-foreground-secondary">{title}</h3>
      {children}
    </section>
  );
}

function AssistantDetail({
  record,
  data,
  locale,
}: {
  record: AssistantActivityRecord;
  data: BootstrapDto;
  locale: Locale;
}) {
  const l = useI18n().messages.aiCenter;
  const result = record.run.proposal?.result;
  const modelByKey = new Map(data.imageGenerationRoutes.map((model) => [model.key, model]));
  return (
    <>
      <AssistantProgressTimeline
        events={record.run.activityEvents ?? []}
        locale={locale}
        running={record.run.status === 'RUNNING'}
      />
      <DetailSection title={l.fields.frozenInput}>
        <p className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-xs leading-relaxed">
          {record.run.input.prompt || '—'}
        </p>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 xl:grid-cols-4">
          <Fact label={l.fields.directTerms}>{record.run.capabilityReceipt.directTermCount}</Fact>
          <Fact label={l.fields.recipes}>{record.run.capabilityReceipt.recipeCount}</Fact>
          <Fact label={l.fields.references}>{record.run.capabilityReceipt.referenceCount}</Fact>
          <Fact label={l.fields.vision}>{l.fields.notAnalyzed}</Fact>
          <Fact label={l.fields.canvas}>
            {record.run.input.canvasWidth && record.run.input.canvasHeight
              ? `${record.run.input.canvasWidth} × ${record.run.input.canvasHeight}`
              : record.run.input.canvasPresetKey || '—'}
          </Fact>
          <Fact label={l.fields.models}>
            {record.run.input.generationTargets
              .map((target) => modelByKey.get(target.modelKey)?.name ?? target.modelKey)
              .join(', ') || '—'}
          </Fact>
          <Fact label={l.fields.provider}>{record.run.providerKey ?? 'codex'}</Fact>
          <Fact label={l.fields.model}>{record.run.modelKey ?? 'codex'}</Fact>
          <Fact label={l.fields.createdAt}>{dateTime(record.run.createdAt, locale)}</Fact>
          <Fact label={l.fields.finishedAt}>{dateTime(record.run.finishedAt, locale)}</Fact>
        </dl>
      </DetailSection>
      {result && record.run.mode === 'directions' && (
        <DetailSection title={l.fields.directions}>
          <div className="divide-y rounded-md border">
            {result.directions.map((direction) => (
              <div key={`${direction.label}:${direction.variableAxis}`} className="grid gap-1.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm font-medium">{direction.label}</strong>
                  <Badge variant="secondary">{direction.variableAxis}</Badge>
                </div>
                <p className="text-xs text-foreground-secondary">{direction.rationale}</p>
                <MetaText>{direction.risk}</MetaText>
              </div>
            ))}
          </div>
        </DetailSection>
      )}
      {result && record.run.mode === 'optimize' && (
        <DetailSection title={l.kinds.optimize}>
          <div className="divide-y rounded-md border">
            {result.promptDraft?.contentNodes.map((node, index) => (
              <div key={`${index}:${node.kind}`} className="grid gap-1.5 p-3 text-xs">
                <Badge variant="secondary">{node.kind}</Badge>
                <span className="text-foreground-secondary">{node.kind === 'TEXT' ? node.text : node.displayName}</span>
              </div>
            ))}
          </div>
        </DetailSection>
      )}
      {record.run.errorMessage && (
        <p className="rounded-md bg-destructive-surface p-3 text-xs text-destructive">{record.run.errorMessage}</p>
      )}
    </>
  );
}

function retryableSlot(slot: StyleExplorationSlotDto) {
  return ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(slot.status);
}

function ExperimentDetail({
  record,
  data,
  onRetrySlot,
}: {
  record: ExperimentActivityRecord;
  data: BootstrapDto;
  onRetrySlot(slotId: string): Promise<void>;
}) {
  const l = useI18n().messages.aiCenter;
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const modelByKey = new Map(data.imageGenerationRoutes.map((model) => [model.key, model]));
  const targets = record.sourceRun?.input.generationTargets ?? [];

  async function retry(slotId: string) {
    if (busySlotId) return;
    setBusySlotId(slotId);
    try {
      await onRetrySlot(slotId);
    } finally {
      setBusySlotId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {record.batch.commonConstraints.map((constraint) => (
          <Badge key={constraint} variant="secondary">
            {constraint}
          </Badge>
        ))}
      </div>
      <DetailSection title={l.fields.realState}>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 xl:grid-cols-4">
          <Fact label={l.fields.completed}>
            {record.batch.completedCount} / {record.batch.totalCount}
          </Fact>
          <Fact label={l.fields.failed}>{record.batch.failedCount}</Fact>
          <Fact label={l.fields.cancelled}>{record.batch.cancelledCount}</Fact>
          <Fact label={l.fields.interrupted}>{record.batch.interruptedCount}</Fact>
          <Fact label={l.fields.models}>
            {targets.map((target) => modelByKey.get(target.modelKey)?.name ?? target.modelKey).join(', ') || '—'}
          </Fact>
          <Fact label={l.fields.cost}>{l.fields.costUnknown}</Fact>
          <Fact label={l.fields.remoteScope}>
            {record.batch.directorTask?.authorization.remoteScope.join(', ') || l.fields.remoteScopeValue}
          </Fact>
          <Fact label={l.fields.createdAt}>{dateTime(record.batch.createdAt, data.locale)}</Fact>
        </dl>
      </DetailSection>
      <DetailSection title={l.fields.slots}>
        <div className="divide-y rounded-md border">
          {record.batch.slots.map((slot) => (
            <div key={slot.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm font-medium">{slot.label}</strong>
                  <Badge variant="outline">{l.statuses[slot.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-foreground-secondary">{slot.rationale}</p>
                <MetaText className="mt-1">
                  {slot.variableAxis} · {slot.completedCount}/{slot.totalCount}
                </MetaText>
              </div>
              {retryableSlot(slot) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busySlotId)}
                  onClick={() => void retry(slot.id)}
                >
                  <RotateCcwIcon className="size-3.5" />
                  {l.actions.retry}
                </Button>
              )}
            </div>
          ))}
        </div>
      </DetailSection>
    </>
  );
}

function GenerationDetail({
  record,
  data,
  locale,
}: {
  record: GenerationActivityRecord;
  data: BootstrapDto;
  locale: Locale;
}) {
  const messages = useI18n().messages;
  const l = messages.aiCenter;
  const model =
    record.run.modelSnapshot?.descriptor ??
    data.imageGenerationRoutes.find((candidate) => candidate.key === record.run.modelKey);
  const quality =
    model?.qualityMode === 'PROVIDER_MANAGED'
      ? messages.creator.generationTargets.providerManagedQuality
      : record.run.quality;
  const prompt =
    record.run.executionInputSnapshot?.commonInput.resolvedPrompt.commonExpression || record.version.finalPrompt;
  return (
    <>
      <DetailSection title={l.fields.frozenInput}>
        <p className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-xs leading-relaxed">
          {prompt || '—'}
        </p>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 xl:grid-cols-4">
          <Fact label={l.fields.model}>{model?.name ?? record.run.modelKey}</Fact>
          <Fact label={l.fields.provider}>{model?.provider ?? '—'}</Fact>
          <Fact label={l.fields.quality}>{quality}</Fact>
          <Fact label={l.fields.dimensions}>
            {record.run.width && record.run.height ? `${record.run.width} × ${record.run.height}` : '—'}
          </Fact>
          <Fact label={l.fields.result}>
            {record.run.asset ? (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="size-3.5" />
                {record.run.asset.width} × {record.run.asset.height}
              </span>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label={l.fields.sourceImage}>
            {record.operation === 'EDIT'
              ? (record.version.sourceImageId ?? record.run.derivation?.sourceAssetId ?? '—')
              : '—'}
          </Fact>
          <Fact label={l.fields.createdAt}>{dateTime(record.run.createdAt, locale)}</Fact>
          <Fact label={l.fields.finishedAt}>{dateTime(record.run.finishedAt ?? null, locale)}</Fact>
        </dl>
      </DetailSection>
      {record.run.codexTask && (
        <DetailSection title={l.fields.codexTask}>
          <div className="grid gap-1 rounded-md bg-surface-sunken p-3">
            <strong className="truncate text-xs font-medium">{record.run.codexTask.threadName}</strong>
            <MetaText mono>{record.run.codexTask.threadId}</MetaText>
          </div>
        </DetailSection>
      )}
      {record.run.errorMessage && (
        <GenerationErrorNotice
          run={record.run}
          className="w-full rounded-md bg-destructive-surface p-3 text-xs"
          summaryClassName="leading-relaxed"
        />
      )}
    </>
  );
}

export function AiActivityDetail({
  record,
  data,
  locale,
  canLocate,
  onLocate,
  onReEditGeneration,
  onRetryGeneration,
  onRetrySlot,
  notify,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const [retrying, setRetrying] = useState(false);
  if (!record) return <div className="grid size-full place-items-center text-sm text-muted-foreground">{l.empty}</div>;

  const source = localizedSeriesTitle(record, locale, canLocate ? l.source.draft : l.source.unknown);
  const kind =
    record.kind === 'ASSISTANT'
      ? record.run.mode === 'directions'
        ? l.kinds.directions
        : l.kinds.optimize
      : record.kind === 'EXPERIMENT'
        ? l.kinds.experiment
        : record.operation === 'EDIT'
          ? l.kinds.edit
          : l.kinds.generate;
  const title =
    record.kind === 'ASSISTANT' && record.occurrenceCount > 1
      ? `${kind} · ${l.occurrence(record.ordinal)}`
      : `${kind} · ${source}`;
  const retryableGeneration =
    record.kind === 'GENERATION' && (record.run.status === 'FAILED' || record.run.status === 'INTERRUPTED');

  async function retryGeneration() {
    if (record?.kind !== 'GENERATION' || retrying) return;
    setRetrying(true);
    try {
      await onRetryGeneration(record.run.id);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetrying(false);
    }
  }

  async function openCodex(threadId: string) {
    try {
      await window.desktopApi.codexOpenThread(threadId);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <ScrollArea className="min-h-0 min-w-0 bg-background">
      <article className="mx-auto grid w-full max-w-5xl gap-4 p-5 lg:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{title}</h2>
              <AiActivityStatusTag record={record} />
            </div>
            <MetaText className="mt-1">
              {source} · {dateTime(record.createdAt, locale)}
            </MetaText>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!canLocate} onClick={() => onLocate(record)}>
              <SquareArrowOutUpRightIcon className="size-3.5" />
              {l.actions.locate}
            </Button>
            {record.kind === 'GENERATION' && retryableGeneration && (
              <Button type="button" variant="outline" size="sm" onClick={() => onReEditGeneration(record.run.id)}>
                <PencilLineIcon className="size-3.5" />
                {l.actions.reEdit}
              </Button>
            )}
            {retryableGeneration && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retrying}
                onClick={() => void retryGeneration()}
              >
                <RotateCcwIcon className="size-3.5" />
                {l.actions.retry}
              </Button>
            )}
            {record.kind === 'GENERATION' && record.run.codexTask && (
              <Button type="button" size="sm" onClick={() => void openCodex(record.run.codexTask!.threadId)}>
                <SquareArrowOutUpRightIcon className="size-3.5" />
                {l.actions.openCodex}
              </Button>
            )}
          </div>
        </header>
        {record.kind === 'ASSISTANT' && <AssistantDetail record={record} data={data} locale={locale} />}
        {record.kind === 'EXPERIMENT' && <ExperimentDetail record={record} data={data} onRetrySlot={onRetrySlot} />}
        {record.kind === 'GENERATION' && <GenerationDetail record={record} data={data} locale={locale} />}
      </article>
    </ScrollArea>
  );
}
