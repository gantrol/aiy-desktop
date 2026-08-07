import type { ImageGenerationRouteDto, GenerationTargetInput, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Input } from '@/renderer/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { QualityPicker } from '@/renderer/components/creator/QualityPicker';

interface CommonProps {
  locale: Locale;
  targets: GenerationTargetInput[];
  onTargetsChange(targets: GenerationTargetInput[]): void;
}

type Props = CommonProps &
  (
    | { routes: ImageGenerationRouteDto[]; models?: never }
    | {
        routes?: never;
        /** @deprecated Compatibility input only. Product code uses routes. */
        models: ImageGenerationRouteDto[];
      }
  );

export function ModelGenerationSettingsTable(props: Props) {
  const { locale, targets, onTargetsChange } = props;
  const routes = props.routes ?? props.models;
  const labels = useI18n().messages.creator.generationTargets;

  function modelName(modelKey: string) {
    if (modelKey === 'internal-library-random') return labels.internalLibraryRandom;
    return routes.find((model) => model.key === modelKey)?.name ?? modelKey;
  }

  function updateTarget(modelKey: string, update: Partial<GenerationTargetInput>) {
    onTargetsChange(targets.map((target) => (target.modelKey === modelKey ? { ...target, ...update } : target)));
  }

  return (
    <div data-generation-model-table className="px-3 pb-3">
      <Table className="table-fixed">
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="h-8 hover:bg-transparent">
            <TableHead className="h-8 w-auto px-0 text-xs font-normal text-muted-foreground">{labels.models}</TableHead>
            <TableHead className="h-8 w-24 px-0 text-center text-xs font-normal tabular-nums text-muted-foreground">
              {labels.imageCount}
            </TableHead>
            <TableHead className="h-8 w-28 px-0 text-center text-xs font-normal text-muted-foreground">
              {labels.quality}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {targets.map((target) => {
            const model = routes.find((item) => item.key === target.modelKey);
            const name = modelName(target.modelKey);
            const provider = model?.internal ? '' : (model?.provider ?? '');
            return (
              <TableRow key={target.modelKey} className="h-12 border-border/70 hover:bg-transparent">
                <TableCell className="min-w-0 px-0 py-1.5">
                  <div className="min-w-0">
                    <div
                      className="truncate font-medium text-foreground"
                      title={provider ? `${name} · ${provider}` : name}
                    >
                      {name}
                    </div>
                    {provider && <div className="truncate text-xs text-muted-foreground">{provider}</div>}
                  </div>
                </TableCell>
                <TableCell numeric className="px-0 py-1.5 text-center">
                  <Input
                    className="mx-auto h-8 w-16 bg-surface px-2 text-center font-mono tabular-nums"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    aria-label={labels.modelImageCount(name)}
                    value={target.count}
                    onChange={(event) => {
                      const count = Number(event.target.value);
                      if (Number.isFinite(count) && count >= 1)
                        updateTarget(target.modelKey, { count: Math.min(100, Math.trunc(count)) });
                    }}
                  />
                </TableCell>
                <TableCell className="px-0 py-1.5 text-center [&_[data-slot=select-trigger]]:mx-auto">
                  {model?.internal ? (
                    <span
                      className="block text-center text-sm text-disabled-foreground"
                      title={labels.notApplicable}
                      aria-label={labels.notApplicable}
                    >
                      —
                    </span>
                  ) : model?.qualityMode === 'PROVIDER_MANAGED' ? (
                    <span
                      className="block text-center text-xs text-muted-foreground"
                      title={labels.providerManagedQuality}
                      aria-label={labels.providerManagedQuality}
                    >
                      {labels.providerManagedQuality}
                    </span>
                  ) : (
                    <QualityPicker
                      locale={locale}
                      value={target.quality}
                      toolbar
                      ariaLabel={labels.modelQuality(name)}
                      onChange={(quality) => updateTarget(target.modelKey, { quality })}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
