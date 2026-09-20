import { useCallback, useState } from 'react';
import { ExternalLink, Images, RotateCcw } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContentSurface } from '@/renderer/components/ui/content-surface';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ImagePlaybackButton } from '@/renderer/components/media/ImagePlaybackButton';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import { NoteAppearanceMenu } from '@/renderer/features/desktop-petals/NoteAppearanceMenu';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { NoteResizeHandle } from '@/renderer/features/desktop-petals/NoteResizeHandle';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';
import { mediaPosterUrl } from '@/shared/media-preview-policy';
import type { DesktopPin } from '@/shared/contracts/petal-board';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

type PinMedia = NonNullable<DesktopPin['media']>;

function mediaForPin(pin: DesktopPin): PinMedia | null {
  if (pin.media) return pin.media;
  // Old snapshots lack MIME/size metadata. Request a bounded still, not an unknown-size original SVG.
  if (!pin.mediaUrl) return null;
  try {
    const url = new URL(pin.mediaUrl);
    if (url.protocol !== 'aiy-media:' || url.hostname !== 'asset') return null;
    return {
      id: decodeURIComponent(url.pathname.slice(1)),
      mediaUrl: pin.mediaUrl,
      mimeType: 'image/unknown',
      width: 0,
      height: 0,
      byteSize: 0,
    };
  } catch {
    return null;
  }
}

function PinnedMedia({
  media,
  title,
  motion,
  disabled,
  open,
}: {
  media: PinMedia;
  title: string;
  motion: 'auto' | 'play' | 'still';
  disabled: boolean;
  open(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.media;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed)
    return (
      <div className="content-surface__empty grid place-content-center justify-items-center gap-3 p-4" role="status">
        <Images aria-hidden="true" />
        <span className="text-xs">{copy.preview}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          <RotateCcw className="size-3.5" />
          {copy.retry}
        </Button>
      </div>
    );
  if (media.mimeType.startsWith('audio/'))
    return (
      <div className="content-surface__empty grid place-content-center justify-items-center gap-3 p-4">
        <strong className="text-sm">{title}</strong>
        <audio
          key={attempt}
          src={media.mediaUrl}
          controls
          preload="none"
          aria-label={title}
          onError={() => setFailed(true)}
        />
      </div>
    );
  const video = media.mimeType.startsWith('video/');
  return (
    <>
      <AssetMedia
        key={attempt}
        asset={media}
        previewSize={512}
        motion={motion}
        controls={video}
        preload="metadata"
        alt={title}
        onError={() => setFailed(true)}
      />
      {!video && (
        <Button
          type="button"
          variant="ghost"
          className="content-surface__open absolute inset-0 size-full rounded-none p-0 hover:bg-transparent active:bg-transparent focus-visible:shadow-[inset_0_0_0_6px_var(--media-surround-dark)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--media-checker-a)] focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100"
          disabled={disabled}
          aria-label={`${copy.original} · ${title}`}
          onClick={open}
        />
      )}
    </>
  );
}

export function ContentPin({ pin, snapshot }: { pin: DesktopPin; snapshot: DesktopPetalSnapshot }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const mediaCopy = copy.media;
  const [error, setError] = useState('');
  const [motion, setMotion] = useState<'auto' | 'play' | 'still'>('auto');
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const title = petalLabel(pin.title, pin.preview) || copy.board[pin.source.kind];
  const media = mediaForPin(pin);
  const open = () => void window.desktopPetals.openMain().catch(onError);
  const noteActions: PetalNoteMenuActions = {
    home: snapshot.home,
    alwaysOnTop: snapshot.alwaysOnTop,
    note: pin,
    board: snapshot.board,
    persisted: true,
    disabled: snapshot.suspended,
    onError,
    onAppearance: (patch) => window.desktopPetals.boardCommand({ kind: 'pin-appearance', id: pin.id, ...patch }),
  };
  if (!snapshot.expanded)
    return (
      <CollapsedPetal
        titlesVisible={snapshot.titlesVisible}
        color={pin.color}
        icon={pin.icon}
        label={title}
        title={title}
        onOpen={() => void window.desktopPetals.expand(true).catch(onError)}
        onError={onError}
        menuActions={{ ...noteActions, onExpand: () => window.desktopPetals.expand(true) }}
        anchor={snapshot.flowerAnchor}
        menuPreview={snapshot.flowerPreview}
      />
    );
  return (
    <ContentSurface
      kind={media ? 'media' : 'paper'}
      title={title}
      titlesVisible={snapshot.titlesVisible}
      className="content-surface--desktop absolute inset-2"
      style={appearanceStyle(pin.color)}
      tools={
        <>
          {media && (
            <ImagePlaybackButton
              asset={media}
              poster={mediaPosterUrl(media.id)}
              motion={motion}
              labels={mediaCopy}
              disabled={snapshot.suspended}
              onMotionChange={setMotion}
            />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={snapshot.suspended}
            aria-label={mediaCopy.original}
            title={mediaCopy.original}
            onClick={open}
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <NoteAppearanceMenu {...noteActions} />
          <PetalNoteActions {...noteActions} onCollapse={() => window.desktopPetals.expand(false)} />
        </>
      }
      status={error ? petalErrorText(error, copy.errors) : undefined}
      resize={
        <div
          className={`content-surface__resize absolute right-0 bottom-0 z-35 size-7 ${media ? 'opacity-0 group-hover/content-surface:opacity-100 group-focus-within/content-surface:opacity-100 [@media(hover:none)]:opacity-100' : ''}`}
        >
          <NoteResizeHandle disabled={snapshot.suspended} onError={onError} />
        </div>
      }
    >
      {media ? (
        <PinnedMedia
          key={`${pin.id}:${media.id}`}
          media={media}
          title={title}
          motion={motion}
          disabled={snapshot.suspended}
          open={open}
        />
      ) : pin.preview ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed select-text">
          {pin.preview}
        </pre>
      ) : (
        <div className="content-surface__empty grid place-content-center justify-items-center gap-3 p-4">
          <Images className="size-10" aria-hidden="true" />
          <Button variant="ghost" disabled={snapshot.suspended} onClick={open}>
            {mediaCopy.original}
          </Button>
        </div>
      )}
    </ContentSurface>
  );
}
