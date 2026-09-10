import { ALargeSmall, Ellipsis, Minimize2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { NoteTitleField } from '@/renderer/features/content-editor/NoteTitleInput';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { StickyNoteSurface } from '@/renderer/features/desktop-petals/StickyNoteSurface';
import { demoNoop } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import {
  demoOutroLayout,
  type DemoOutroNoteTargets,
  type demoOutroNoteState,
} from '@/renderer/features/extensions/feature-demo/v050/demoOutroScene';
import {
  demoOutroCues,
  type DemoOutroNoteId,
} from '@/renderer/features/extensions/feature-demo/v050/demoOutroTimeline';
import { demoOutroMedia } from '@/renderer/features/extensions/feature-demo/v050/demoOutroMedia';
import { between, type Point } from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import { useI18n } from '@/renderer/i18n/useI18n';

const emptyAssets: [] = [];

export function DemoOutroNote({
  time,
  id,
  state,
  onTargets,
  onError,
}: {
  time: number;
  id: DemoOutroNoteId;
  state: ReturnType<typeof demoOutroNoteState>['note'];
  onTargets(targets: DemoOutroNoteTargets): void;
  onError(): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.extensions.featureDemo.v050.outro;
  const labels = messages.desktopPetals;
  const { note } = demoOutroLayout;
  const root = useRef<HTMLDivElement>(null);
  const collapse = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pasted = time >= demoOutroCues.generation.paste;

  useLayoutEffect(() => {
    if (id !== 'generation') return;
    const bounds = root.current?.getBoundingClientRect();
    const button = collapse.current?.getBoundingClientRect();
    const content = body.current?.getBoundingClientRect();
    if (!bounds?.width || !button?.width || !content?.width) return;
    // Normalize both rectangles through the same note and stage transforms.
    const project = (x: number, y: number): Point => [
      note.x + ((x - bounds.left) / bounds.width) * note.width * note.scale,
      note.y + ((y - bounds.top) / bounds.height) * note.height * note.scale,
    ];
    onTargets({
      collapse: project(button.left + button.width / 2, button.top + button.height / 2),
      body: project(content.left + content.width * 0.08, content.top + content.height * 0.05),
    });
  }, [onTargets, note, id]);

  return (
    <div
      className="absolute"
      aria-hidden={state.opacity === 0}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        transformOrigin: 'top left',
        transform: `scale(${note.scale})`,
      }}
    >
      <div
        ref={root}
        className="relative size-full"
        style={{
          opacity: state.opacity,
          transformOrigin: 'top left',
          transform: `translate(${state.offset[0]}px, ${state.offset[1]}px) scale(${state.scale})`,
          visibility: state.opacity > 0 ? 'visible' : 'hidden',
        }}
      >
        <StickyNoteSurface
          className="inset-0"
          color="rose"
          icon="feather"
          animate={false}
          nativeDrag={false}
          actions={
            <div className="flex shrink-0 items-center gap-0.5">
              <PetalIconButton label={labels.actions.more} onClick={demoNoop}>
                <Ellipsis />
              </PetalIconButton>
              <PetalIconButton ref={collapse} label={labels.note.collapse} onClick={demoNoop}>
                <Minimize2 />
              </PetalIconButton>
            </div>
          }
        >
          <NoteTitleField compact readOnly value={id === 'generation' ? copy.generationTitle : copy.originsTitle} />
          <div ref={body} className="min-h-0 flex-1 overflow-hidden">
            {id === 'generation' ? (
              // ContentInput initializes once per session. Preload the full text, then reveal the paste atomically.
              <div className="size-full" style={{ visibility: pasted ? 'inherit' : 'hidden' }} aria-hidden={!pasted}>
                <ContentInput
                  key={copy.generationBody}
                  markdown={copy.generationBody}
                  assets={emptyAssets}
                  sessionIdentity={`v050-generation-note-${locale}`}
                  compact
                  embedded
                  readOnly
                  onChange={demoNoop}
                  onSave={demoNoop}
                  onError={onError}
                />
              </div>
            ) : (
              <DemoOutroReference time={time} onError={onError} />
            )}
          </div>
          <footer className="flex shrink-0 items-center gap-0.5 px-3 py-1.5">
            <PetalIconButton label={labels.document.format} onClick={demoNoop}>
              <ALargeSmall />
            </PetalIconButton>
          </footer>
        </StickyNoteSurface>
      </div>
    </div>
  );
}

function DemoOutroReference({ time, onError }: { time: number; onError(): void }) {
  const copy = useI18n().messages.extensions.featureDemo.v050.outro;
  const cues = demoOutroCues.origins;
  const body = between(time, cues.opened, cues.bodyRevealed);
  const reference = between(time, cues.reference, cues.referenceRevealed);
  return (
    <div className="space-y-3 px-6 py-3">
      <p className="text-[15px] leading-6" style={{ opacity: body, transform: `translateY(${4 * (1 - body)}px)` }}>
        {copy.originsBody}
      </p>
      <div className="space-y-2" style={{ opacity: reference, transform: `translateY(${6 * (1 - reference)}px)` }}>
        <p className="text-[15px] leading-6">{copy.originsReferenceLead}</p>
        <figure className="flex items-end gap-4">
          <img
            src={demoOutroMedia.ijiri}
            alt={copy.paperTitle}
            className="h-[160px] w-auto shrink-0 object-contain"
            onError={onError}
          />
          <figcaption className="min-w-0">
            <div className="text-[15px] font-semibold leading-5">{copy.paperTitle}</div>
            <div className="mt-1 text-xs leading-4">{copy.paperAuthors}</div>
            <div className="text-xs leading-4 text-selected-foreground">2005</div>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
