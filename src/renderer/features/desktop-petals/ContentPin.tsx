import { useCallback, useState } from 'react';
import { ExternalLink, Images, RotateCcw, Pencil, EyeOff } from 'lucide-react';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { ImageEditor } from '@/renderer/features/image-editing/ImageEditor';
import { Button } from '@/renderer/components/ui/button';
import { ContentSurface } from '@/renderer/components/ui/content-surface';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ImagePlaybackButton } from '@/renderer/components/media/ImagePlaybackButton';
import { NoteDisplayMenu } from '@/renderer/features/desktop-petals/NoteDisplayMenu';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import { PetalNoteOperations } from '@/renderer/features/desktop-petals/PetalNoteOperations';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { NoteResizeHandle } from '@/renderer/features/desktop-petals/NoteResizeHandle';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';
import { mediaPosterUrl } from '@/shared/media-preview-policy';
import { usePetalDrag } from '@/renderer/features/desktop-petals/use-petal-drag';
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
  onError,
}: {
  media: PinMedia;
  title: string;
  motion: 'auto' | 'play' | 'still';
  disabled: boolean;
  onError(reason: unknown): void;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.media;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const drag = usePetalDrag(undefined, onError);
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
          className="absolute inset-0 size-full touch-none cursor-grab rounded-none p-0 hover:bg-transparent active:cursor-grabbing active:bg-transparent focus-visible:shadow-[inset_0_0_0_6px_var(--media-surround-dark)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--media-checker-a)] focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100"
          disabled={disabled}
          aria-label={`${copy.move} · ${title}`}
          {...drag.handlers}
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
  const [editing, setEditing] = useState(false);
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const title = petalLabel(pin.title, pin.preview) || copy.board[pin.source.kind];
  const media = mediaForPin(pin);
  const collection = pin.source.kind === 'ALBUM' || pin.source.kind === 'MATERIAL_ALBUM';
  const canEdit = Boolean(snapshot.temporary && media && ['image/png', 'image/jpeg'].includes(media.mimeType));
  const edit = async () => {
    if (!snapshot.expanded) await window.desktopPetals.expand(true);
    setEditing(true);
  };
  const open = () => void window.desktopPetals.openMain().catch(onError);
  const noteActions: PetalNoteMenuActions = {
    temporary: Boolean(snapshot.temporary),
    promotionTarget: snapshot.temporaryTargetSpace,
    onEditImage: canEdit ? edit : undefined,
    ...imageFileActions(collection ? null : media),
    onPromote: snapshot.temporary
      ? () =>
          window.desktopPetals.temporaryFiles({
            kind: 'promote',
            id: pin.id,
            expectedHash: snapshot.notes[0].contentHash,
          })
      : undefined,
    onConvert: snapshot.temporary
      ? () => window.desktopPetals.temporaryFiles({ kind: 'convert', id: pin.id })
      : undefined,
    home: snapshot.home,
    alwaysOnTop: snapshot.alwaysOnTop,
    note: pin,
    board: snapshot.board,
    persisted: true,
    disabled: snapshot.suspended || editing,
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
        menuPreview={snapshot.flowerPreview}
      />
    );
  return (
    <ContentSurface
      kind={editing ? 'editor' : media && !collection ? 'media' : 'paper'}
      title={title}
      contextLabel={snapshot.temporary ? copy.temporary.title : `${copy.scope.current} · ${snapshot.libraryName}`}
      titlesVisible={snapshot.titlesVisible}
      className={`content-surface--desktop absolute inset-2 ${snapshot.temporary ? 'outline outline-1 outline-dashed -outline-offset-2 outline-current' : ''}`}
      style={appearanceStyle(pin.color)}
      leading={<PetalNoteOperations {...noteActions} />}
      tools={
        <ContentPinToolbar
          media={collection ? null : media}
          editing={editing}
          onEdit={canEdit ? edit : undefined}
          snapshot={snapshot}
          actions={noteActions}
          scale={pinTextScale(pin, snapshot)}
          motion={motion}
          onMotion={setMotion}
        />
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
      {editing ? (
        <ImageEditor key={pin.id} id={pin.id} suspended={snapshot.suspended} onClose={() => setEditing(false)} />
      ) : collection ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-4">
          {media ? (
            <div className="h-32 w-full min-h-0">
              <AssetMedia
                asset={media}
                previewSize={192}
                motion="still"
                alt={title}
                className="size-full object-contain"
              />
            </div>
          ) : (
            <Images className="size-8" aria-hidden="true" />
          )}
          <span className="text-xs text-muted-foreground">{copy.board[pin.source.kind]}</span>
          <Button variant="outline" className="max-w-full" disabled={snapshot.suspended} onClick={open}>
            <span className="truncate">{title}</span>
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      ) : media ? (
        <PinnedMedia
          key={`${pin.id}:${media.id}`}
          media={media}
          title={title}
          motion={motion}
          disabled={snapshot.suspended}
          onError={onError}
        />
      ) : pin.preview ? (
        <pre
          style={{ zoom: snapshot.contentScale ?? 1 }}
          className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed select-text"
        >
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

function imageFileActions(media: PinMedia | null) {
  if (!media?.mimeType.startsWith('image/')) return {};
  return {
    onOpenFile: () => window.desktopPetals.assetFile({ assetId: media.id, action: 'open' }),
    onCopyImage: () => window.desktopPetals.assetFile({ assetId: media.id, action: 'copy' }),
    onSaveAs: () => window.desktopPetals.assetFile({ assetId: media.id, action: 'save-as' }),
  };
}

function ContentPinToolbar({
  media,
  editing,
  onEdit,
  snapshot,
  actions,
  scale,
  motion,
  onMotion,
}: {
  media: PinMedia | null;
  editing: boolean;
  onEdit?: () => Promise<void>;
  snapshot: DesktopPetalSnapshot;
  actions: PetalNoteMenuActions;
  scale?: number;
  motion: 'auto' | 'play' | 'still';
  onMotion(value: 'auto' | 'play' | 'still'): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  return (
    <>
      {onEdit && !editing && (
        <PetalIconButton
          label={copy.imageEditor.edit}
          disabled={snapshot.suspended}
          onClick={() => void onEdit().catch(actions.onError)}
        >
          <Pencil />
        </PetalIconButton>
      )}
      {media && !editing && (
        <ImagePlaybackButton
          asset={media}
          poster={mediaPosterUrl(media.id, 512, media.mediaUrl)}
          motion={motion}
          labels={copy.media}
          disabled={snapshot.suspended}
          onMotionChange={onMotion}
        />
      )}
      <NoteDisplayMenu scale={scale} actions={actions} />
      {editing && (
        <PetalIconButton
          label={copy.actions.hide}
          disabled={snapshot.suspended}
          onClick={() => void window.desktopPetals.hide().catch(actions.onError)}
        >
          <EyeOff />
        </PetalIconButton>
      )}
      <PetalNoteActions
        {...actions}
        disabled={snapshot.suspended}
        onCollapse={() => window.desktopPetals.expand(false)}
      />
    </>
  );
}

function pinTextScale(pin: DesktopPin, snapshot: DesktopPetalSnapshot) {
  if (mediaForPin(pin) || !pin.preview || pin.source.kind === 'ALBUM' || pin.source.kind === 'MATERIAL_ALBUM')
    return undefined;
  return snapshot.contentScale ?? 1;
}
