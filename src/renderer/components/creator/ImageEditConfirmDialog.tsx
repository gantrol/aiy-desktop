import { useEffect, useMemo, useState } from 'react';
import { CircleAlertIcon, LoaderCircleIcon, PlayIcon, SendIcon, ShieldCheckIcon } from 'lucide-react';
import type {
  AnnotationDto,
  ImageGenerationRouteDto,
  GenerationTargetInput,
  ImageEditMode,
  Locale,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ModelGenerationSettingsTable } from '@/renderer/components/creator/ModelGenerationSettingsTable';
import { ModelTargetSelector } from '@/renderer/components/creator/ModelTargetSelector';

export interface ImageEditConfirmValue {
  annotationIds: string[];
  targets: GenerationTargetInput[];
  mode: Exclude<ImageEditMode, 'AUTO'>;
}

interface Props {
  open: boolean;
  locale: Locale;
  annotations: AnnotationDto[];
  routes: ImageGenerationRouteDto[];
  preferredTargets: GenerationTargetInput[];
  supportingReferenceCount: number;
  nativeMaskAvailable: boolean;
  busy?: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onConfirm(value: ImageEditConfirmValue): void | Promise<void>;
}

function readyEditModels(
  routes: readonly ImageGenerationRouteDto[],
  preferredTargets: readonly GenerationTargetInput[],
) {
  const eligible = routes.filter((model) => model.state === 'READY' && model.capabilities.includes('IMAGE_EDIT'));
  const preferredOrder = new Map(preferredTargets.map((target, index) => [target.modelKey, index]));
  return [...eligible].sort(
    (left, right) =>
      (preferredOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (preferredOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

function qualityForModel(
  model: ImageGenerationRouteDto | undefined,
  preferredTargets: readonly GenerationTargetInput[],
) {
  const preferred = preferredTargets.find((target) => target.modelKey === model?.key)?.quality;
  const supported = model?.supportedQualities ?? [];
  if (preferred && (!supported.length || supported.includes(preferred))) return preferred;
  if (supported.includes('medium')) return 'medium' as const;
  return supported[0] ?? 'medium';
}

function targetForModel(
  model: ImageGenerationRouteDto,
  currentTargets: readonly GenerationTargetInput[],
  preferredTargets: readonly GenerationTargetInput[],
): GenerationTargetInput {
  const existing =
    currentTargets.find((target) => target.modelKey === model.key) ??
    preferredTargets.find((target) => target.modelKey === model.key);
  const supported = model.supportedQualities ?? [];
  return {
    modelKey: model.key,
    count: existing?.count ?? 1,
    quality:
      existing && (!supported.length || supported.includes(existing.quality))
        ? existing.quality
        : qualityForModel(model, preferredTargets),
  };
}

function initialTargets(
  eligibleModels: readonly ImageGenerationRouteDto[],
  preferredTargets: readonly GenerationTargetInput[],
) {
  const eligibleByKey = new Map(eligibleModels.map((model) => [model.key, model]));
  const preferred = preferredTargets.flatMap((target) => {
    const model = eligibleByKey.get(target.modelKey);
    return model ? [targetForModel(model, [], preferredTargets)] : [];
  });
  if (preferred.length) return preferred;
  return eligibleModels[0] ? [targetForModel(eligibleModels[0], [], preferredTargets)] : [];
}

export function ImageEditConfirmDialog({
  open,
  locale,
  annotations,
  routes,
  preferredTargets,
  supportingReferenceCount,
  nativeMaskAvailable,
  busy = false,
  error = '',
  onOpenChange,
  onConfirm,
}: Props) {
  const copy = useI18n().messages.creator.imageEditConfirm;
  const eligibleModels = useMemo(() => readyEditModels(routes, preferredTargets), [routes, preferredTargets]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<GenerationTargetInput[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(annotations.map((annotation) => annotation.id));
    setTargets(initialTargets(eligibleModels, preferredTargets));
  }, [open]);

  const selectedModels = targets.flatMap(
    (target) => eligibleModels.find((model) => model.key === target.modelKey) ?? [],
  );
  const selectedWithoutMaskEdit = selectedModels.filter((model) => !model.capabilities.includes('MASK_EDIT'));
  const mode =
    selectedModels.length &&
    nativeMaskAvailable &&
    selectedModels.every((model) => model.capabilities.includes('MASK_EDIT'))
      ? 'MASK'
      : 'SEMANTIC';
  const maximumRuns = targets.reduce((total, target) => total + target.count, 0);
  const canConfirm = Boolean(targets.length && selectedIds.length && !busy);

  function selectModels(modelKeys: string[]) {
    setTargets((current) =>
      modelKeys.flatMap((modelKey) => {
        const model = eligibleModels.find((candidate) => candidate.key === modelKey);
        return model ? [targetForModel(model, current, preferredTargets)] : [];
      }),
    );
  }

  function toggleAnnotation(annotationId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, annotationId])] : current.filter((id) => id !== annotationId),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy || next) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] max-w-xl overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-primary" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section aria-label={copy.changes}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold">{copy.changes}</h3>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => setSelectedIds(annotations.map((annotation) => annotation.id))}
                >
                  {copy.all}
                </Button>
                <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setSelectedIds([])}>
                  {copy.none}
                </Button>
              </div>
            </div>
            <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto rounded-lg border bg-surface-sunken/35 p-2">
              {annotations.map((annotation, index) => (
                <label
                  key={annotation.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-hover"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selectedIds.includes(annotation.id)}
                    disabled={busy}
                    onCheckedChange={(checked) => toggleAnnotation(annotation.id, checked === true)}
                  />
                  <span className="min-w-0">
                    <span className="mr-1 font-mono text-muted-foreground">#{index + 1}</span>
                    {annotation.comment}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <div className="space-y-2">
            <div className="space-y-1.5 text-xs font-medium">
              <span>{copy.model}</span>
              <ModelTargetSelector
                routes={eligibleModels}
                selectedModelKeys={targets.map((target) => target.modelKey)}
                capabilityTag={{
                  supports: (model) => model.capabilities.includes('MASK_EDIT'),
                  supportedLabel: copy.maskEditSupported,
                  unsupportedLabel: copy.maskEditUnsupported,
                }}
                onSelectedModelKeysChange={selectModels}
              />
            </div>
            {selectedWithoutMaskEdit.length > 0 && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning"
              >
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                {copy.maskEditUnavailable(selectedWithoutMaskEdit.map((model) => model.name).join(', '))}
              </div>
            )}
            {!selectedWithoutMaskEdit.length && selectedModels.length > 0 && !nativeMaskAvailable && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning"
              >
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                {copy.nativeMaskUnavailable}
              </div>
            )}
            {targets.length > 0 && (
              <div className="overflow-hidden rounded-lg border bg-surface-sunken/25">
                <ModelGenerationSettingsTable
                  locale={locale}
                  routes={eligibleModels}
                  targets={targets}
                  onTargetsChange={setTargets}
                />
              </div>
            )}
          </div>

          <section className="rounded-lg border bg-surface-sunken/40 p-3" aria-label={copy.boundary}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold">{copy.boundary}</span>
              <Badge variant={mode === 'MASK' ? 'secondary' : 'outline'}>
                {mode === 'MASK' ? copy.modeMask : copy.modeSemantic}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-foreground-secondary">
              {mode === 'MASK' ? copy.strictBoundary : copy.semanticBoundary}
            </p>
          </section>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border bg-surface-sunken/40 p-3 text-xs">
            <dt className="text-muted-foreground">{copy.runs}</dt>
            <dd className="text-right font-semibold tabular-nums">{copy.maximumRuns(maximumRuns)}</dd>
            <dt className="text-muted-foreground">{copy.cost}</dt>
            <dd className="text-right font-medium text-warning">{copy.unknown}</dd>
          </dl>

          <section className="rounded-lg border border-warning/30 bg-warning-surface p-3" aria-label={copy.remote}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <SendIcon className="size-3.5" />
              {copy.remote}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-foreground-secondary">
              <li>· {copy.source(maximumRuns)}</li>
              <li>· {copy.instructions(selectedIds.length)}</li>
              {supportingReferenceCount > 0 && <li>· {copy.references(supportingReferenceCount)}</li>}
              {mode === 'MASK' && <li>· {copy.mask}</li>}
            </ul>
          </section>

          {!selectedIds.length && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-surface px-3 py-2 text-xs text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {copy.selectionRequired}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-surface px-3 py-2 text-xs text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() =>
              void onConfirm({
                annotationIds: selectedIds,
                targets: targets.map((target) => ({ ...target })),
                mode,
              })
            }
          >
            {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
            {busy ? copy.starting : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
