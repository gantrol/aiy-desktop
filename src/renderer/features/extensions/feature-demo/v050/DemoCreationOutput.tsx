import { Columns2, Ellipsis, History, Images, Search, SlidersHorizontal, Square, Upload } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { ImageMagnifier, ImageMagnifierScaleBadge } from '@/renderer/components/creator/ImageMagnifier';
import { ImageVariantMenu } from '@/renderer/components/creator/ImageVariantMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';
import {
  demoFacePoint,
  demoFaceTarget,
  demoWorkspaceLayout,
} from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';
import {
  demoAsyncNoop,
  demoNoop,
  demoRoseAsset,
} from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';

const launcher = { busy: false, isCurrent: () => true, open: demoAsyncNoop };
const beforeOpen = async () => true;

export function DemoCreationOutput({ time, onError }: { time: number; onError(): void }) {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo.v050;
  const visible = time >= demoCues.result;
  const magnifying = time >= demoCues.faceArrive && time < demoCues.faceLeave;
  const point = demoFacePoint(time);
  const center = demoFaceTarget(time);
  const bounds = demoWorkspaceLayout.image;
  return (
    <aside className="relative flex min-h-0 flex-col bg-muted">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <Segmented type="single" value="image">
          <SegmentedItem value="image" aria-label={copy.resultImage}>
            <Images className="size-4" />
          </SegmentedItem>
          <SegmentedItem value="settings" aria-label={messages.creator.generationTargets.modelParameters}>
            <SlidersHorizontal className="size-4" />
          </SegmentedItem>
          <SegmentedItem value="history" aria-label={messages.creator.derivedVisual.inputHistory}>
            <History className="size-4" />
          </SegmentedItem>
        </Segmented>
        <div className="flex items-center gap-1">
          <ImageVariantMenu
            seriesId="demo-roses-series"
            asset={visible ? demoRoseAsset : null}
            animations={[]}
            beforeOpen={beforeOpen}
            onCreateContent={demoAsyncNoop}
            notify={demoNoop}
            menuOpen={time >= demoCues.variantOpen && time < demoCues.gifOpen}
            onMenuOpenChange={demoNoop}
            animationLauncher={launcher}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={messages.creator.workbench.importResults}
            onClick={demoNoop}
          >
            <Upload />
          </Button>
          <Segmented type="single" value="preview">
            <SegmentedItem value="preview" aria-label={copy.resultImage}>
              <Square className="size-4" />
            </SegmentedItem>
            <SegmentedItem value="compare" aria-label={messages.creator.inspector.comparison}>
              <Columns2 className="size-4" />
            </SegmentedItem>
          </Segmented>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-media-surround-light">
        <img
          data-demo-media="result"
          data-demo-result
          src={demoRoseAsset.mediaUrl}
          alt={copy.resultImage}
          className="object-contain"
          width={bounds.width}
          height={bounds.height}
          style={{ width: bounds.width, height: bounds.height, visibility: visible ? 'visible' : 'hidden' }}
          onError={onError}
        />
        {visible && (
          <div className="absolute bottom-3 right-3 flex gap-2">
            <Button
              data-demo-magnify
              variant={time >= demoCues.magnify && time < demoCues.faceLeave ? 'secondary' : 'outline'}
              size="icon"
              aria-label={copy.inspectFace}
              onClick={demoNoop}
            >
              <Search />
            </Button>
            <Button variant="outline" size="icon" aria-label={messages.creator.results.more} onClick={demoNoop}>
              <Ellipsis />
            </Button>
          </div>
        )}
      </div>
      <footer className="h-28 shrink-0 border-t px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{copy.prepared}</span>
          <span>1024 × 1536</span>
        </div>
        {visible && (
          <img
            src={demoRoseAsset.mediaUrl}
            alt=""
            className="h-16 w-11 rounded-sm object-contain ring-1 ring-selected-border"
          />
        )}
      </footer>
      {magnifying && (
        <div className="pointer-events-none fixed z-30" style={{ left: center[0] - 120, top: center[1] - 120 }}>
          <ImageMagnifier
            diameter={240}
            label={copy.inspectFace}
            point={point}
            scale={2.8}
            layers={[{ id: demoRoseAsset.id, src: demoRoseAsset.mediaUrl, width: bounds.width, height: bounds.height }]}
          >
            <ImageMagnifierScaleBadge scale={2.8} visible />
          </ImageMagnifier>
        </div>
      )}
    </aside>
  );
}
