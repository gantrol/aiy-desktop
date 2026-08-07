import { ChevronDownIcon } from 'lucide-react';
import type { ImageGenerationRouteDto, GenerationQuality, GenerationTargetInput, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

interface Props {
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  targets: GenerationTargetInput[];
  onTargetsChange(targets: GenerationTargetInput[]): void;
}

const fallbackQualities: GenerationQuality[] = ['low', 'medium', 'high'];

function modelForTarget(routes: readonly ImageGenerationRouteDto[], target: GenerationTargetInput) {
  return routes.find((model) => model.key === target.modelKey);
}

function selectableQualities(model: ImageGenerationRouteDto, current: GenerationQuality) {
  const supported = model.supportedQualities?.length ? model.supportedQualities : fallbackQualities;
  return supported.includes(current) ? supported : [current, ...supported];
}

export function GenerationQualitySelector({ locale, routes, targets, onTargetsChange }: Props) {
  const creatorMessages = useI18n().messages.creator;
  const labels = creatorMessages.generationTargets;
  const separator = locale === 'zh' ? '：' : ': ';

  function modelName(target: GenerationTargetInput) {
    const model = modelForTarget(routes, target);
    return target.modelKey === 'internal-library-random'
      ? labels.internalLibraryRandom
      : (model?.name ?? target.modelKey);
  }

  function qualityValue(target: GenerationTargetInput) {
    const model = modelForTarget(routes, target);
    if (model?.internal) return labels.notApplicable;
    if (model?.qualityMode === 'PROVIDER_MANAGED') return labels.providerManagedQuality;
    return creatorMessages.quality[target.quality];
  }

  function isSelectable(target: GenerationTargetInput) {
    const model = modelForTarget(routes, target);
    return Boolean(model && !model.internal && model.qualityMode === 'SELECTABLE');
  }

  function setQuality(modelKey: string, quality: GenerationQuality) {
    onTargetsChange(targets.map((target) => (target.modelKey === modelKey ? { ...target, quality } : target)));
  }

  function qualitySelect(target: GenerationTargetInput, model: ImageGenerationRouteDto) {
    const name = modelName(target);
    return (
      <Select value={target.quality} onValueChange={(value) => setQuality(target.modelKey, value as GenerationQuality)}>
        <SelectTrigger className="h-8 w-20 bg-surface px-2 text-xs" aria-label={labels.modelQuality(name)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {selectableQualities(model, target.quality).map((quality) => (
            <SelectItem key={quality} value={quality}>
              {creatorMessages.quality[quality]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (!targets.length) return null;
  const qualityValues = [...new Set(targets.map(qualityValue))];
  const summary = `${labels.quality}${separator}${qualityValues.join(' / ')}`;
  const selectableTargets = targets.filter(isSelectable);

  if (selectableTargets.length === 1) {
    const target = selectableTargets[0];
    const model = modelForTarget(routes, target)!;
    return (
      <div
        data-generation-quality-summary
        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        title={summary}
      >
        <span className="hidden @3xl/launcher:inline">
          · {labels.quality}
          {separator}
        </span>
        {qualitySelect(target, model)}
      </div>
    );
  }

  if (!selectableTargets.length) {
    return (
      <span data-generation-quality-summary className="shrink-0 text-xs text-muted-foreground" title={summary}>
        <span className="hidden @3xl/launcher:inline">
          · {labels.quality}
          {separator}
        </span>
        {qualityValues.join(' / ')}
      </span>
    );
  }

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          data-generation-quality-summary
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-1.5 text-xs font-normal text-muted-foreground"
          title={summary}
          aria-label={summary}
        >
          <span>
            <span className="hidden @3xl/launcher:inline">
              · {labels.quality}
              {separator}
            </span>
            {qualityValues.join(' / ')}
          </span>
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-2">
        <div className="space-y-1">
          {targets.map((target) => {
            const model = modelForTarget(routes, target);
            const name = modelName(target);
            return (
              <div key={target.modelKey} className="flex min-h-10 items-center gap-3 rounded-md px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                  {name}
                </span>
                {model && isSelectable(target) ? (
                  qualitySelect(target, model)
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{qualityValue(target)}</span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
