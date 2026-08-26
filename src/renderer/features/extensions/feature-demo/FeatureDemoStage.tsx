import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2Icon } from 'lucide-react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { CODEX_IMAGE_DISCOVERY_EXTENSION_ID } from '@/shared/extension-ids';
import { Badge } from '@/renderer/components/ui/badge';
import { GenerationComparison } from '@/renderer/components/creator/GenerationComparison';
import { StyleExplorationPanel } from '@/renderer/components/creator/StyleExplorationPanel';
import type { VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import { CodexImageDiscoveryConfiguration } from '@/renderer/features/extensions/CodexImageDiscoveryConfiguration';
import { FeatureDemoDirectoryTree } from '@/renderer/features/extensions/feature-demo/FeatureDemoDirectoryTree';
import type { FeatureDemoRunPlan } from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import { VideoDocumentsScreen } from '@/renderer/features/video-documents/VideoDocumentsScreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  featureDemoSceneAt,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

interface FeatureDemoStageProps {
  data: BootstrapDto;
  extensions: readonly ExtensionDto[];
  plan: FeatureDemoRunPlan;
  timeInSeconds: number;
  notify(message: string): void;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ease(value: number) {
  const bounded = clamp(value);
  return bounded < 0.5 ? 4 * bounded * bounded * bounded : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
}

function DemoScene({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!active}
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ visibility: active ? 'visible' : 'hidden' }}
    >
      {children}
      <div className="absolute inset-0 z-50" aria-hidden="true" />
    </div>
  );
}

function FeatureDemoCursor({ x, y }: { x: number; y: number }) {
  return (
    <MousePointer2Icon
      data-feature-demo-cursor
      aria-hidden="true"
      className="pointer-events-none absolute z-[80] size-10 fill-background text-foreground"
      style={{ left: x, top: y, transform: 'translate(-3px, -3px)' }}
    />
  );
}

export const FeatureDemoStage = forwardRef<HTMLDivElement, FeatureDemoStageProps>(function FeatureDemoStage(
  { data, extensions, plan, timeInSeconds, notify },
  forwardedRef,
) {
  const { messages } = useI18n();
  const position = featureDemoSceneAt(timeInSeconds, plan.scenes);
  const styleRootRef = useRef<HTMLDivElement | null>(null);
  const directoryRootRef = useRef<HTMLDivElement | null>(null);
  const openedBatchIdRef = useRef<string | null>(null);
  const directoryHoverPreviewRef = useRef<HTMLElement | null>(null);
  const [directoryCursorTarget, setDirectoryCursorTarget] = useState({ x: 74, y: 190 });
  const [documentLocation, setDocumentLocation] = useState<VideoDocumentsLocation>({
    collection: { kind: 'all' },
    documentId: null,
  });
  const demoBatch = useMemo(
    () => data.styleExplorationBatches.filter((batch) => batch.id === plan.styleBatchId).slice(0, 1),
    [data.styleExplorationBatches, plan.styleBatchId],
  );
  const comparisonSeries = useMemo(
    () => data.series.find((series) => series.id === plan.comparisonSeriesId) ?? null,
    [data.series, plan.comparisonSeriesId],
  );
  const codexExtension = extensions.find((extension) => extension.manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID);
  const detailsProgress =
    position.scene.id === 'directionDetailsExpand'
      ? ease((position.progress - 0.16) / 0.5)
      : position.scene.id === 'directionDetailsCollapse'
        ? 1 - ease((position.progress - 0.18) / 0.5)
        : 0;
  const directoryOpenProgress =
    position.scene.id === 'directoryExpand'
      ? ease((position.progress - 0.34) / 0.26)
      : position.scene.id === 'directoryCollapse'
        ? 1 - ease((position.progress - 0.3) / 0.26)
        : 0;
  const styleSceneActive =
    position.scene.id === 'directionDetailsExpand' || position.scene.id === 'directionDetailsCollapse';
  const directorySceneActive = position.scene.id === 'directoryExpand' || position.scene.id === 'directoryCollapse';

  const directionApproach = ease(clamp((position.progress - 0.04) / 0.3));
  const directionLeave = ease(clamp((position.progress - 0.18) / 0.42));
  const directionCursor =
    position.scene.id === 'directionDetailsCollapse'
      ? {
          x: 356 + (1160 - 356) * directionLeave,
          y: 338 + (650 - 338) * directionLeave,
        }
      : {
          x: 1160 + (356 - 1160) * directionApproach,
          y: 650 + (338 - 650) * directionApproach,
        };
  const directoryApproach = ease(clamp((position.progress - 0.04) / 0.24));
  const directoryGesture = ease(clamp((position.progress - 0.32) / 0.3));
  const directoryCursor =
    position.scene.id === 'directoryCollapse'
      ? {
          x: directoryCursorTarget.x,
          y: directoryCursorTarget.y + 46 - 82 * directoryGesture,
        }
      : {
          x: 1160 + (directoryCursorTarget.x - 1160) * directoryApproach,
          y: 650 + (directoryCursorTarget.y - 650) * directoryApproach + 46 * directoryGesture,
        };

  useEffect(() => {
    const batchId = demoBatch[0]?.id ?? null;
    if (!batchId || openedBatchIdRef.current === batchId) return;
    const frame = window.requestAnimationFrame(() => {
      const trigger = styleRootRef.current?.querySelector<HTMLButtonElement>(
        '[data-style-exploration-batch] header button[aria-expanded="false"]',
      );
      trigger?.click();
      openedBatchIdRef.current = batchId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [demoBatch]);

  useLayoutEffect(() => {
    function applyDetailsProgress() {
      const details = styleRootRef.current?.querySelector<HTMLDetailsElement>('[data-slot-title-region]');
      const panel = details?.querySelector<HTMLElement>('[data-slot-details]');
      if (!details || !panel) return;
      details.open = detailsProgress > 0.001;
      details.style.backgroundColor =
        detailsProgress > 0.001 ? 'color-mix(in srgb, var(--overlay) 95%, transparent)' : 'transparent';
      details.style.opacity = '1';
      panel.style.visibility = detailsProgress > 0.001 ? 'visible' : 'hidden';
      panel.style.maxHeight = `${Math.round(320 * detailsProgress)}px`;
      panel.style.opacity = String(detailsProgress);
      panel.style.paddingBottom = `${Math.round(12 * detailsProgress)}px`;
    }

    applyDetailsProgress();
    const frame = window.requestAnimationFrame(applyDetailsProgress);
    return () => window.cancelAnimationFrame(frame);
  }, [demoBatch, detailsProgress]);

  useLayoutEffect(() => {
    if (!directorySceneActive) return;

    function locateDirectoryPreview() {
      const root = directoryRootRef.current;
      const preview = root?.querySelector<HTMLElement>('[data-album-tree-preview]');
      if (!root || !preview) return;

      if (directoryHoverPreviewRef.current !== preview) {
        directoryHoverPreviewRef.current?.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
        );
        preview.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        directoryHoverPreviewRef.current = preview;
      }

      const rootRect = root.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const stageRect = root.closest<HTMLElement>('[data-feature-demo-stage]')?.getBoundingClientRect() ?? rootRect;
      const scale = stageRect.width > 0 ? FEATURE_DEMO_PREVIEW_WIDTH / stageRect.width : 1;
      const nextTarget = {
        x: (previewRect.left - stageRect.left + previewRect.width * 0.5) * scale,
        y: (previewRect.top - stageRect.top + previewRect.height * 0.5) * scale,
      };
      setDirectoryCursorTarget((current) =>
        Math.abs(current.x - nextTarget.x) < 0.5 && Math.abs(current.y - nextTarget.y) < 0.5 ? current : nextTarget,
      );
    }

    locateDirectoryPreview();
    const frame = window.requestAnimationFrame(locateDirectoryPreview);
    return () => window.cancelAnimationFrame(frame);
  }, [directorySceneActive]);

  useEffect(() => {
    if (directorySceneActive) return;
    directoryHoverPreviewRef.current?.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    directoryHoverPreviewRef.current = null;
  }, [directorySceneActive]);

  return (
    <div
      ref={forwardedRef}
      data-feature-demo-stage
      aria-label={messages.extensions.featureDemo.previewAria}
      className="relative isolate overflow-hidden bg-background text-foreground"
      style={{ width: FEATURE_DEMO_PREVIEW_WIDTH, height: FEATURE_DEMO_PREVIEW_HEIGHT }}
    >
      <DemoScene active={styleSceneActive} className="bg-surface-sunken p-5 pt-16">
        <div ref={styleRootRef} className="size-full overflow-hidden rounded-xl border bg-background p-4">
          <StyleExplorationPanel
            batches={demoBatch}
            series={data.series}
            onStop={() => undefined}
            onRetrySlot={() => undefined}
            onProposeAdjacent={() => undefined}
            onContinueDirection={() => undefined}
            onOpenAsset={() => undefined}
          />
        </div>
      </DemoScene>

      <DemoScene active={position.scene.id === 'codexImages'} className="bg-background pt-14">
        {codexExtension && (
          <CodexImageDiscoveryConfiguration
            active
            standalone
            extension={codexExtension}
            notify={notify}
            onOpenCreation={async () => undefined}
          />
        )}
      </DemoScene>

      <DemoScene active={position.scene.id === 'promptCompare'} className="bg-background pt-14">
        {comparisonSeries && (
          <div
            className="flex size-full min-h-0 overflow-hidden border-t"
            data-feature-demo-selected-asset={plan.comparisonAssetId ?? undefined}
          >
            <GenerationComparison
              series={comparisonSeries}
              locale={data.locale}
              terms={data.terms}
              wordPalettes={data.wordPalettes}
              routes={data.imageGenerationRoutes}
              tasks={data.generationTasks}
              fullWindow={false}
              onFullWindowChange={() => undefined}
              onSelectAsset={() => undefined}
              onGenerate={async () => undefined}
              onGeneratePrompt={async () => undefined}
              onRetry={async () => undefined}
              onReEdit={() => undefined}
              notify={notify}
            />
          </div>
        )}
      </DemoScene>

      <DemoScene active={directorySceneActive} className="bg-surface-sunken p-8 pt-[5.5rem]">
        <div className="size-full overflow-hidden rounded-xl border bg-background">
          <div ref={directoryRootRef} className="h-full w-[28rem] border-r">
            <FeatureDemoDirectoryTree data={data} openProgress={directoryOpenProgress} />
          </div>
        </div>
      </DemoScene>

      <DemoScene active={position.scene.id === 'videoDocument'} className="bg-background pt-14">
        <div className="size-full">
          <VideoDocumentsScreen
            active
            externalDocumentUpdate={null}
            albums={data.albums}
            location={documentLocation}
            onNavigate={setDocumentLocation}
            onAlbumsChange={() => undefined}
            onLibraryChange={() => undefined}
            onOpenSourceMaterial={() => undefined}
            notify={notify}
          />
        </div>
      </DemoScene>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[70] flex h-14 items-center gap-3 border-b bg-overlay/95 px-5 backdrop-blur-sm">
        <Badge variant="secondary" className="tabular-nums">
          {String(position.sceneIndex + 1).padStart(2, '0')}
        </Badge>
        <strong className="text-sm">{messages.extensions.featureDemo.scenes[position.scene.id].title}</strong>
        <span className="truncate text-xs text-muted-foreground">
          {messages.extensions.featureDemo.scenes[position.scene.id].subtitle}
        </span>
      </div>

      {styleSceneActive && <FeatureDemoCursor x={directionCursor.x} y={directionCursor.y} />}
      {directorySceneActive && <FeatureDemoCursor x={directoryCursor.x} y={directoryCursor.y} />}
    </div>
  );
});
