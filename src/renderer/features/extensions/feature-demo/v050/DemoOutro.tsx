import { useCallback, useState } from 'react';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { RoseFlowerView } from '@/renderer/features/desktop-petals/RoseFlower';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PETAL_SHAPE_LAYOUT } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { DemoExitWindow, DemoExitTray } from '@/renderer/features/extensions/feature-demo/v050/DemoExitWindow';
import {
  demoExitLayout,
  demoExitScene,
  type DemoExitPreview,
  type DemoExitTargets,
} from '@/renderer/features/extensions/feature-demo/v050/demoExitScene';
import { DemoOutroNote } from '@/renderer/features/extensions/feature-demo/v050/DemoOutroNote';
import { DemoOutroDownloads } from '@/renderer/features/extensions/feature-demo/v050/DemoOutroDownloads';
import { DemoPointer } from '@/renderer/features/extensions/feature-demo/v050/DemoPointer';
import { demoSmileImages } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import { useDemoOutroMedia } from '@/renderer/features/extensions/feature-demo/v050/demoOutroMedia';
import {
  demoOutroLayout,
  demoOutroScene,
  type DemoOutroNoteTargets,
} from '@/renderer/features/extensions/feature-demo/v050/demoOutroScene';
import { demoOutroCues, demoOutroNoteIds } from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';
import {
  demoSmileDuration,
  demoSmileFrameAtElapsed,
} from '@/renderer/features/extensions/feature-demo/v050/demoSmileData';
import { useI18n } from '@/renderer/i18n/useI18n';

/** A prepared desktop cut, followed by two real note surfaces. No user notes or wallpaper are changed. */
export function DemoOutro({
  time,
  onReady,
  onError,
}: {
  time: number;
  onReady(ready: boolean): void;
  onError(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.extensions.featureDemo.v050;
  const { flower, note, portrait } = demoOutroLayout;
  const [targets, setTargets] = useState<DemoOutroNoteTargets>({
    collapse: [note.x + (note.width - 34) * note.scale, note.y + 28 * note.scale],
    body: [note.x + 40 * note.scale, note.y + 92 * note.scale],
  });
  const onTargets = useCallback((next: DemoOutroNoteTargets) => {
    setTargets((current) =>
      Math.hypot(current.collapse[0] - next.collapse[0], current.collapse[1] - next.collapse[1]) < 0.1 &&
      Math.hypot(current.body[0] - next.body[0], current.body[1] - next.body[1]) < 0.1
        ? current
        : next,
    );
  }, []);
  const [exitTargets, setExitTargets] = useState<DemoExitTargets>({ quit: [1725, 994] });
  const onExitTargets = useCallback((next: DemoExitTargets) => {
    setExitTargets((current) =>
      Math.hypot(current.quit[0] - next.quit[0], current.quit[1] - next.quit[1]) < 0.1 ? current : next,
    );
  }, []);
  const [exitPreview, setExitPreview] = useState<DemoExitPreview>(demoExitLayout.preview);
  const onExitPreview = useCallback((next: DemoExitPreview) => {
    setExitPreview((current) =>
      Math.abs(current.x - next.x) + Math.abs(current.y - next.y) + Math.abs(current.width - next.width) < 0.1
        ? current
        : next,
    );
  }, []);
  const exit = demoExitScene(time, exitTargets.quit, exitPreview);
  useDemoOutroMedia(onReady, onError);
  const state = demoOutroScene(time, targets);
  const smileStart = time >= demoOutroCues.repository ? demoOutroCues.repository : demoOutroCues.brand;
  const smileElapsed = (time - smileStart) * 1000;
  // Start and end on the existing peak frame; let it complete one loop during the brand reveal.
  const smile =
    smileElapsed < 0 || smileElapsed >= demoSmileDuration ? 4 : demoSmileFrameAtElapsed(1500 + smileElapsed);
  return (
    <div
      data-demo-outro
      className="pointer-events-none absolute inset-0 isolate bg-selected text-foreground"
      style={{ opacity: state.opacity }}
      aria-hidden={time < 0}
    >
      <DemoExitWindow time={time} previewWidth={exitPreview.width} onPreview={onExitPreview} />
      <div
        className="absolute inset-0 z-10 isolate origin-top-left overflow-hidden bg-selected"
        inert={time >= demoOutroCues.returnWindow}
        style={{ transform: exit.transform, visibility: time >= demoOutroCues.closed ? 'hidden' : 'visible' }}
      >
        <img
          src={demoSmileImages[smile]}
          alt={copy.smileTitle}
          className="absolute object-contain"
          style={{ left: portrait.x, top: portrait.y, width: portrait.width, height: portrait.height }}
          onError={onError}
        />
        <div className="absolute" style={{ left: flower.x, top: flower.y }}>
          <RoseFlowerView size={flower.size} pull={state.pull} animate={false} showDetachedPetal={false} />
        </div>
        <div
          className="absolute w-[830px] origin-top-left"
          style={{
            left: note.x,
            top: portrait.y,
            transform: `scale(${1 - 0.35 * state.brandCompact})`,
          }}
        >
          <div
            className="origin-bottom-left text-[112px] font-semibold leading-none tracking-tight"
            style={{
              opacity: state.brand,
              transform: `translateY(${18 * (1 - state.brand)}px) scale(${0.98 + 0.02 * state.brand})`,
            }}
          >
            {copy.title}
          </div>
          <div className="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span
              className="text-[52px] font-medium leading-tight text-selected-foreground"
              style={{ opacity: state.slogan, transform: `translateY(${12 * (1 - state.slogan)}px)` }}
            >
              {copy.outro.slogan}
            </span>
            <span
              className="text-[36px] leading-tight"
              style={{ opacity: state.secondarySlogan, transform: `translateY(${10 * (1 - state.secondarySlogan)}px)` }}
            >
              {copy.outro.secondarySlogan}
            </span>
          </div>
        </div>
        {demoOutroNoteIds.map((id) => {
          const item = state.notes[id];
          return (
            <div key={id}>
              {item.petal.opacity > 0 && (
                <div
                  className="absolute"
                  style={{
                    ...appearanceStyle('rose'),
                    left: item.petal.position[0] - PETAL_SHAPE_LAYOUT.width / 2,
                    top: item.petal.position[1] - PETAL_SHAPE_LAYOUT.height / 2,
                    width: PETAL_SHAPE_LAYOUT.width,
                    height: PETAL_SHAPE_LAYOUT.height,
                    opacity: item.petal.opacity,
                  }}
                >
                  <PetalShape icon="feather" />
                </div>
              )}
              <DemoOutroNote time={time} id={id} state={item.note} onTargets={onTargets} onError={onError} />
            </div>
          );
        })}
        <div className="absolute top-[410px] w-[830px]" style={{ left: note.x }}>
          <DemoOutroDownloads progress={state.repository} onError={onError} />
        </div>
        <DemoPointer scene={state} />
      </div>
      <DemoExitTray time={time} onTargets={onExitTargets} />
      <div className="pointer-events-none absolute inset-0 z-30">
        <DemoPointer scene={exit} />
      </div>
    </div>
  );
}
