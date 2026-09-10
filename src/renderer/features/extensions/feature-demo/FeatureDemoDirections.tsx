import type { BootstrapDto } from '@/shared/contracts';
import { StyleExplorationSlotCard } from '@/renderer/components/creator/StyleExplorationPanel';
import { styleExplorationSlotAssets } from '@/renderer/components/creator/styleExplorationAssets';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { FeatureDemoRunPlan } from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import type { directionDemoStateAt } from '@/renderer/features/extensions/feature-demo/featureDemoSceneState';
import { useI18n } from '@/renderer/i18n/useI18n';

export function FeatureDemoDirections({
  data,
  plan,
  state,
}: {
  data: BootstrapDto;
  plan: FeatureDemoRunPlan;
  state: ReturnType<typeof directionDemoStateAt>;
}) {
  const copy = useI18n().messages.extensions.featureDemo;
  const batch = data.styleExplorationBatches.find((candidate) => candidate.id === plan.styleBatchId);
  const slot = batch?.slots.find((candidate) => candidate.id === plan.styleSlotId);
  if (!batch || !slot)
    return <div className="grid size-full place-items-center text-sm text-muted-foreground">{copy.noDirections}</div>;
  const assets = styleExplorationSlotAssets(slot, data.series);
  const shownAssets = state.showResult ? assets.slice(0, 1) : assets.slice(0, 4);
  return (
    <div className="flex size-full min-h-0 gap-6">
      <ScrollArea className="h-full w-[30rem] shrink-0">
        <StyleExplorationSlotCard
          batchId={batch.id}
          batchTerminal={batch.activeCount === 0 && !batch.slots.some((candidate) => candidate.activeCount > 0)}
          slot={slot}
          series={data.series}
          detailsOpen={state.detailsOpen}
          retrying={false}
          proposingAdjacent={false}
          onRetrySlot={() => undefined}
          onProposeAdjacent={() => undefined}
          onContinueDirection={() => undefined}
          onOpenAsset={() => undefined}
        />
      </ScrollArea>
      <div
        className="grid min-w-0 flex-1 auto-rows-fr gap-4"
        style={{ gridTemplateColumns: shownAssets.length > 1 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}
      >
        {shownAssets.map((asset) => (
          <AssetMedia key={asset.id} asset={asset} alt={slot.label} className="size-full min-h-0 object-contain" />
        ))}
      </div>
    </div>
  );
}
