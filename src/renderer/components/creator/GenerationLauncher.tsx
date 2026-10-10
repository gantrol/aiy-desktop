import { useId, useState, type ReactNode } from 'react';
import { ImagePlusIcon, LoaderCircleIcon, Settings2Icon } from 'lucide-react';
import type { ImageGenerationRouteDto, GenerationTargetInput, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ResponsiveButton } from '@/renderer/components/ui/responsive-button';
import { shortcutTokens } from '@/renderer/commands/app-shortcuts';
import { GenerationBatchControl } from '@/renderer/components/creator/GenerationBatchControl';
import { generationBatchPlan } from '@/renderer/components/creator/generationBatchPlan';
import { GenerationQualitySelector } from '@/renderer/components/creator/GenerationQualitySelector';
import type { GenerationReadiness } from '@/renderer/components/creator/generationReadiness';
import { ModelGenerationSettingsTable } from '@/renderer/components/creator/ModelGenerationSettingsTable';
import { ModelTargetSelector } from '@/renderer/components/creator/ModelTargetSelector';

interface CommonProps {
  embedded?: boolean;
  locale: Locale;
  generationTargets: GenerationTargetInput[];
  generationCount: number;
  readiness: GenerationReadiness;
  starting: boolean;
  interactionBlocked?: boolean;
  secondaryAction?: ReactNode;
  onGenerationTargetsChange(targets: GenerationTargetInput[]): void;
  onConfigureExtension?(extensionId: string): void;
  onGenerate(): void;
}

interface Props extends CommonProps {
  routes?: ImageGenerationRouteDto[];
  /** @deprecated Compatibility input only. Product code uses routes. */
  models?: ImageGenerationRouteDto[];
}

/** Explains exceptional incompatibilities without narrating routine empty states. */
export function useGenerationBlockMessage(readiness: GenerationReadiness) {
  const labels = useI18n().messages.creator.generationTargets;
  if (readiness.ready || !readiness.reason) return '';
  switch (readiness.reason) {
    case 'PROMPT_EMPTY':
    case 'NO_MODEL':
      return '';
    case 'MODEL_UNAVAILABLE':
      return labels.blockedModelUnavailable(readiness.modelName || labels.models, readiness.availabilityReason);
    case 'MODEL_CANNOT_GENERATE':
      return labels.blockedModelCannotGenerate(readiness.modelName);
    case 'REFERENCE_UNSUPPORTED':
      return labels.blockedReferenceUnsupported(readiness.modelName);
    case 'MULTI_REFERENCE_UNSUPPORTED':
      return labels.blockedMultiReferenceUnsupported(readiness.modelName);
    case 'TOO_MANY_REFERENCES':
      return labels.blockedTooManyReferences(readiness.modelName, readiness.referenceLimit);
    default:
      return '';
  }
}

export function GenerationLauncher(props: Props) {
  const {
    embedded = false,
    locale,
    generationTargets,
    generationCount,
    readiness,
    starting,
    interactionBlocked = false,
    secondaryAction,
    onGenerationTargetsChange,
    onConfigureExtension,
    onGenerate,
  } = props;
  const routes = props.routes ?? props.models ?? [];
  const labels = useI18n().messages.creator.generationTargets;
  const platform = window.desktopApi.appPlatform;
  const generationShortcut = shortcutTokens(
    { key: 'Enter', meta: platform === 'darwin', ctrl: platform !== 'darwin' },
    platform,
  ).join('+');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const blockedMessageId = useId();
  const blockMessage = useGenerationBlockMessage(readiness);
  const canGenerate = readiness.ready && !starting && !interactionBlocked;
  const batchPlan = generationBatchPlan(generationTargets);
  const modelNames = generationTargets.map((target) =>
    target.modelKey === 'internal-library-random'
      ? labels.internalLibraryRandom
      : (routes.find((model) => model.key === target.modelKey)?.name ?? target.modelKey),
  );
  const modelSummary = modelNames.join(' + ') || labels.noneSelected;
  const launcherModelLabel = labels.launcherModels;
  const batchSummary =
    batchPlan.uniformRepeatCount === null
      ? labels.batchTotal(batchPlan.modelCount, batchPlan.totalCount)
      : labels.batchSummary(batchPlan.modelCount, batchPlan.uniformRepeatCount, batchPlan.totalCount);

  function selectModels(modelKeys: string[]) {
    const defaultCount = batchPlan.uniformRepeatCount ?? generationTargets[0]?.count ?? 1;
    const defaultQuality = generationTargets[0]?.quality ?? 'low';
    onGenerationTargetsChange(
      modelKeys.map((modelKey) => {
        const route = routes.find((model) => model.key === modelKey);
        const supported = route?.supportedQualities ?? [];
        return (
          generationTargets.find((target) => target.modelKey === modelKey) ?? {
            modelKey,
            count: defaultCount,
            quality:
              route?.qualityMode === 'SELECTABLE' && supported.length && !supported.includes(defaultQuality)
                ? supported.includes('medium')
                  ? 'medium'
                  : supported[0]
                : defaultQuality,
          }
        );
      }),
    );
  }

  const generateButton = (
    <Button
      data-action="generate"
      type="button"
      size={embedded ? 'sm' : 'lg'}
      className={cn(
        'shrink-0 bg-generation-action text-generation-action-foreground hover:bg-generation-action-hover active:bg-generation-action-hover',
        'min-w-24',
      )}
      disabled={!canGenerate}
      title={blockMessage || generationShortcut}
      aria-busy={starting}
      aria-keyshortcuts="Control+Enter Meta+Enter"
      aria-describedby={blockMessage ? blockedMessageId : undefined}
      onClick={onGenerate}
    >
      {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
      {starting ? labels.generating : labels.generate}
      {!starting && generationCount > 1 ? ` ${new Intl.NumberFormat(locale).format(generationCount)}` : ''}
    </Button>
  );

  const summary = (
    <div
      data-generation-model-summary
      className="flex min-w-32 flex-1 basis-32 items-center gap-1"
      title={`${launcherModelLabel} ${modelSummary} · ${batchSummary}`}
    >
      <Popover modal open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger asChild>
          <ResponsiveButton
            type="button"
            data-action="generation-settings"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            label={labels.modelParameters}
            aria-expanded={settingsOpen}
          >
            <Settings2Icon className="size-4" />
          </ResponsiveButton>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="max-h-[min(32rem,75vh)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
          aria-label={labels.modelParameters}
        >
          <GenerationBatchControl targets={generationTargets} onTargetsChange={onGenerationTargetsChange} />
          <ModelGenerationSettingsTable
            locale={locale}
            routes={routes}
            targets={generationTargets}
            onTargetsChange={onGenerationTargetsChange}
          />
        </PopoverContent>
      </Popover>
      <span data-generation-model-label className="hidden shrink-0 text-sm text-muted-foreground @3xl/launcher:inline">
        {launcherModelLabel}
      </span>
      <ModelTargetSelector
        compact
        routes={routes}
        selectedModelKeys={generationTargets.map((target) => target.modelKey)}
        onSelectedModelKeysChange={selectModels}
        onConfigureExtension={onConfigureExtension}
      />
      {!embedded && (
        <GenerationQualitySelector
          locale={locale}
          routes={routes}
          targets={generationTargets}
          onTargetsChange={onGenerationTargetsChange}
        />
      )}
      {batchPlan.totalCount > 1 && (
        <span
          data-generation-batch-summary
          className="hidden shrink-0 text-xs tabular-nums text-muted-foreground @min-[720px]/launcher:inline"
        >
          {batchSummary}
        </span>
      )}
    </div>
  );

  return (
    <section
      data-generation-launcher="minimal"
      data-embedded={embedded || undefined}
      className={cn(
        '@container/launcher shrink-0 overflow-hidden',
        embedded ? 'bg-surface' : 'rounded-md border bg-surface',
      )}
    >
      <div className={cn('flex flex-wrap items-center gap-2 py-2', embedded ? 'px-6' : 'px-3')}>
        {summary}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          {secondaryAction}
          {generateButton}
        </div>
      </div>
      {blockMessage && (
        <p
          id={blockedMessageId}
          data-generation-blocked
          role="status"
          className="border-t px-3 py-2 text-xs text-muted-foreground"
        >
          {blockMessage}
        </p>
      )}
    </section>
  );
}
