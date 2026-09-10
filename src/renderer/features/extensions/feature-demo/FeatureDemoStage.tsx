import { forwardRef, useMemo, type ReactNode } from 'react';
import { MousePointer2Icon } from 'lucide-react';
import type { BootstrapDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { GenerationComparison } from '@/renderer/components/creator/GenerationComparison';
import { FeatureDemoCodexImages } from '@/renderer/features/extensions/feature-demo/FeatureDemoCodexImages';
import { FeatureDemoDirectoryTree } from '@/renderer/features/extensions/feature-demo/FeatureDemoDirectoryTree';
import { FeatureDemoDirections } from '@/renderer/features/extensions/feature-demo/FeatureDemoDirections';
import { FeatureDemoVideoDocument } from '@/renderer/features/extensions/feature-demo/FeatureDemoVideoDocument';
import { FeatureDemoImageCreation } from '@/renderer/features/extensions/feature-demo/FeatureDemoImageCreation';
import { FeatureDemoPetalNote } from '@/renderer/features/extensions/feature-demo/FeatureDemoPetalNote';
import {
  DIRECTORY_DEMO_LAYOUT,
  directoryDemoStateAt,
  isDirectoryScene,
} from '@/renderer/features/extensions/feature-demo/featureDemoDirectoryScene';
import {
  comparisonDemoStateAt,
  featureDemoCursorAt,
  directionDemoStateAt,
} from '@/renderer/features/extensions/feature-demo/featureDemoSceneState';
import type { FeatureDemoRunPlan } from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import type { FeatureDemoVideoState } from '@/renderer/features/extensions/feature-demo/useFeatureDemoVideoSnapshot';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  featureDemoSceneAt,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

interface FeatureDemoStageProps {
  data: BootstrapDto;
  plan: FeatureDemoRunPlan;
  videoState: FeatureDemoVideoState;
  timeInSeconds: number;
  notify(message: string): void;
}

const ignore = () => undefined;
const ignoreAsync = async () => undefined;

function DemoScene({ active, className, children }: { active: boolean; className?: string; children: ReactNode }) {
  if (!active) return null;
  return (
    <div inert className={cn('absolute inset-0 overflow-hidden', className)}>
      {children}
    </div>
  );
}

function FeatureDemoCursor({ x, y }: { x: number; y: number }) {
  return (
    <MousePointer2Icon
      data-feature-demo-cursor
      aria-hidden="true"
      className="pointer-events-none absolute z-30 size-10 fill-background text-foreground"
      style={{ left: x, top: y, transform: 'translate(-3px, -3px)' }}
    />
  );
}

export const FeatureDemoStage = forwardRef<HTMLDivElement, FeatureDemoStageProps>(function FeatureDemoStage(
  { data, plan, videoState, timeInSeconds, notify },
  forwardedRef,
) {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo;
  const position = featureDemoSceneAt(timeInSeconds, plan.scenes);
  const comparisonSeries = useMemo(
    () => data.series.find((series) => series.id === plan.comparisonSeriesId) ?? null,
    [data.series, plan.comparisonSeriesId],
  );
  const pairIds: readonly [string, string] | null =
    plan.comparisonAssetId && plan.comparisonSecondAssetId
      ? [plan.comparisonAssetId, plan.comparisonSecondAssetId]
      : null;
  const comparison = comparisonDemoStateAt(position.progress);
  const styleSceneActive =
    position.scene.id === 'directionDetailsExpand' || position.scene.id === 'directionDetailsCollapse';
  const directoryState = isDirectoryScene(position.scene.id)
    ? directoryDemoStateAt(position.scene.id, position.progress)
    : null;
  const cursor = featureDemoCursorAt(position.scene.id, position.progress);

  return (
    <div
      ref={forwardedRef}
      data-feature-demo-stage
      aria-label={copy.previewAria}
      className="relative isolate overflow-hidden bg-background text-foreground"
      style={{ width: FEATURE_DEMO_PREVIEW_WIDTH, height: FEATURE_DEMO_PREVIEW_HEIGHT }}
    >
      <DemoScene active={position.scene.id === 'petalNote'} className="bg-background">
        <FeatureDemoPetalNote progress={position.progress} />
      </DemoScene>
      <DemoScene active={styleSceneActive} className="bg-surface-sunken px-8 pb-8 pt-[5.5rem]">
        <FeatureDemoDirections
          data={data}
          plan={plan}
          state={directionDemoStateAt(position.scene.id, position.progress)}
        />
      </DemoScene>

      <DemoScene active={position.scene.id === 'imageCreation'} className="bg-background pt-14">
        <FeatureDemoImageCreation data={data} plan={plan} progress={position.progress} />
      </DemoScene>

      <DemoScene active={position.scene.id === 'codexImages'} className="bg-background pt-14">
        <FeatureDemoCodexImages />
      </DemoScene>

      <DemoScene active={position.scene.id === 'promptCompare'} className="bg-background pt-14">
        {comparisonSeries && pairIds ? (
          <div
            className="flex size-full min-h-0 overflow-hidden"
            data-feature-demo-selected-asset={comparison.secondAsset ? pairIds[1] : pairIds[0]}
          >
            <GenerationComparison
              series={comparisonSeries}
              locale={data.locale}
              terms={data.terms}
              wordPalettes={data.wordPalettes}
              routes={data.imageGenerationRoutes}
              tasks={data.generationTasks}
              presentation={{
                assetIds: pairIds,
                focusAssetId: comparison.secondAsset ? pairIds[1] : pairIds[0],
                view: comparison.view,
                mode: comparison.mode,
              }}
              fullWindow={false}
              onFullWindowChange={ignore}
              onSelectAsset={ignore}
              onGenerate={ignoreAsync}
              onGeneratePrompt={ignoreAsync}
              onRetry={ignoreAsync}
              onReEdit={ignore}
              notify={notify}
            />
          </div>
        ) : (
          <div className="grid size-full place-items-center text-sm text-muted-foreground">{copy.noComparison}</div>
        )}
      </DemoScene>

      <DemoScene active={directoryState !== null} className="bg-surface-sunken">
        <div
          className="absolute"
          style={{
            left: DIRECTORY_DEMO_LAYOUT.left,
            right: DIRECTORY_DEMO_LAYOUT.left,
            top: DIRECTORY_DEMO_LAYOUT.top,
            bottom: DIRECTORY_DEMO_LAYOUT.bottom,
          }}
        >
          {directoryState && <FeatureDemoDirectoryTree data={data} state={directoryState} />}
        </div>
      </DemoScene>

      <DemoScene active={position.scene.id === 'videoDocument'} className="bg-background px-8 pb-8 pt-[5.5rem]">
        <FeatureDemoVideoDocument state={videoState} progress={position.progress} />
      </DemoScene>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b bg-overlay/95 px-5 backdrop-blur-sm">
        <Badge variant="secondary" className="tabular-nums">
          {String(position.sceneIndex + 1).padStart(2, '0')}
        </Badge>
        <strong className="text-sm">{copy.scenes[position.scene.id].title}</strong>
      </div>
      {cursor && <FeatureDemoCursor x={cursor.x} y={cursor.y} />}
    </div>
  );
});
