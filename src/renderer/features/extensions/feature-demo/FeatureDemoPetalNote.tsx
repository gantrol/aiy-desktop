import { ALargeSmall, Ellipsis, Minimize2 } from 'lucide-react';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { NoteTitleField } from '@/renderer/features/content-editor/NoteTitleInput';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { RoseFlowerView } from '@/renderer/features/desktop-petals/RoseFlower';
import { StickyNoteSurface } from '@/renderer/features/desktop-petals/StickyNoteSurface';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PETAL_SHAPE_LAYOUT } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { PETAL_DEMO_LAYOUT, petalDemoStateAt } from '@/renderer/features/extensions/feature-demo/featureDemoPetalScene';
import { useI18n } from '@/renderer/i18n/useI18n';

const ignore = () => undefined;
const emptyAssets: [] = [];

export function FeatureDemoPetalNote({ progress }: { progress: number }) {
  const copy = useI18n().messages.desktopPetals;
  const state = petalDemoStateAt(progress);
  const { flower, note, release } = PETAL_DEMO_LAYOUT;
  return (
    <div className="absolute inset-0" data-feature-demo-petal-note>
      <div className="absolute" style={{ left: flower.x, top: flower.y }}>
        <RoseFlowerView size={flower.size} pull={state.pull} animate={false} showDetachedPetal={false} />
      </div>
      {state.petal.opacity > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{
            ...appearanceStyle('rose'),
            left: state.petal.x - PETAL_SHAPE_LAYOUT.width / 2,
            top: state.petal.y - PETAL_SHAPE_LAYOUT.height / 2,
            width: PETAL_SHAPE_LAYOUT.width,
            height: PETAL_SHAPE_LAYOUT.height,
            opacity: state.petal.opacity,
          }}
        >
          <PetalShape icon="feather" />
        </div>
      )}
      {state.note.visible && (
        <div
          className="absolute"
          style={{
            left: note.x,
            top: note.y,
            width: note.width,
            height: note.height,
            transformOrigin: `${release.x - note.x}px ${release.y - note.y}px`,
            transform: `scale(${state.note.scale})`,
            opacity: state.note.opacity,
          }}
        >
          <StickyNoteSurface
            color="rose"
            icon="feather"
            animate={false}
            nativeDrag={false}
            actions={
              <div className="flex shrink-0 items-center gap-0.5">
                <PetalIconButton label={copy.actions.more}>
                  <Ellipsis />
                </PetalIconButton>
                <PetalIconButton label={copy.note.collapse}>
                  <Minimize2 />
                </PetalIconButton>
              </div>
            }
          >
            <NoteTitleField compact readOnly value="" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ContentInput
                markdown=""
                assets={emptyAssets}
                sessionIdentity="feature-demo-new-petal-note"
                compact
                embedded
                readOnly
                onChange={ignore}
                onSave={ignore}
                onError={ignore}
              />
            </div>
            <footer className="flex shrink-0 items-center gap-0.5 px-3 py-1.5">
              <PetalIconButton label={copy.document.format}>
                <ALargeSmall />
              </PetalIconButton>
            </footer>
          </StickyNoteSurface>
        </div>
      )}
    </div>
  );
}
