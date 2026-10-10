import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Images, RotateCcw, Pencil, EyeOff } from 'lucide-react';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { ImageEditor } from '@/renderer/features/image-editing/ImageEditor';
import { ImageEditorBoundary } from '@/renderer/features/image-editing/ImageEditorBoundary';
import { Button } from '@/renderer/components/ui/button';
import { ContentSurface } from '@/renderer/components/ui/content-surface';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { ImagePlaybackButton } from '@/renderer/components/media/ImagePlaybackButton';
import { NoteDisplayMenu } from '@/renderer/features/desktop-petals/NoteDisplayMenu';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import { PetalNoteOperations } from '@/renderer/features/desktop-petals/PetalNoteOperations';
import { PetalNoteContextMenu } from '@/renderer/features/desktop-petals/PetalNoteContextMenu';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { NoteResizeHandle } from '@/renderer/features/desktop-petals/NoteResizeHandle';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';
import { mediaPosterUrl } from '@/shared/media-preview-policy';
import { usePetalDrag } from '@/renderer/features/desktop-petals/use-petal-drag';
import { useImagePinNavigation } from '@/renderer/features/desktop-petals/use-image-pin-navigation';
import { temporaryImageTitle } from '@/renderer/features/desktop-petals/temporary-image-title';
import type { DesktopPin } from '@/shared/contracts/petal-board';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

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
  original = false,
}: {
  media: PinMedia;
  title: string;
  motion: 'auto' | 'play' | 'still';
  disabled: boolean;
  onError(reason: unknown): void;
  original?: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.media;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const drag = usePetalDrag(undefined, onError);
  const navigation = useImagePinNavigation(original && !disabled, onError);
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
        previewSize={
          original && media.width * media.height <= 32_000_000 && media.byteSize <= 25 * 1024 * 1024 ? undefined : 512
        }
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
          className="absolute inset-0 z-20 size-full touch-none cursor-grab rounded-none bg-transparent p-0 [-webkit-app-region:no-drag] hover:bg-transparent active:cursor-grabbing active:bg-transparent focus-visible:shadow-[inset_0_0_0_6px_var(--media-surround-dark)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--media-checker-a)] focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100"
          disabled={disabled}
          aria-label={`${copy.move} · ${title}`}
          {...drag.handlers}
          {...navigation}
          onPointerDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            drag.handlers.onPointerDown(event);
          }}
        />
      )}
    </>
  );
}

export function ContentPin({ pin, snapshot }: { pin: DesktopPin; snapshot: DesktopPetalSnapshot }) {
  const { messages, locale } = useI18n();
  const copy = messages.desktopPetals;
  const mediaCopy = copy.media;
  const [error, setError] = useState('');
  const [chromeTarget, setChromeTarget] = useState<HTMLSpanElement | null>(null);
  const [motion, setMotion] = useState<'auto' | 'play' | 'still'>('auto');
  const [manualEditing, setEditing] = useState(false);
  const [closedEditRequest, setClosedEditRequest] = useState<string>();
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const drag = usePetalDrag(undefined, onError);
  const headerDrag = {
    ...drag.handlers,
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!snapshot.suspended && !(event.target as HTMLElement).closest('button, input, textarea, a, [role=menu]'))
        drag.handlers.onPointerDown(event);
    },
  };
  const title = pinTitle(pin, snapshot, locale, copy);
  const media = mediaForPin(pin);
  const collection = pin.source.kind === 'ALBUM' || pin.source.kind === 'MATERIAL_ALBUM';
  const canEdit = canEditPinImage(snapshot, media);
  const compact = Boolean(media?.mimeType.startsWith('image/') && !collection);
  const editing =
    manualEditing || Boolean(canEdit && snapshot.imageEditRequest && snapshot.imageEditRequest !== closedEditRequest);
  useEffect(() => {
    if (!editing || !snapshot.expanded) return;
    const show = () => {
      if (!document.hidden) void window.desktopPetals.windowTools({ kind: 'editing', active: true }).catch(onError);
    };
    show();
    document.addEventListener('visibilitychange', show);
    return () => {
      document.removeEventListener('visibilitychange', show);
      void window.desktopPetals.windowTools({ kind: 'editing', active: false }).catch(onError);
    };
  }, [editing, snapshot.expanded, onError]);
  const edit = async () => {
    if (!snapshot.expanded) await window.desktopPetals.expand(true);
    setEditing(true);
  };
  const closeEditor = async () => {
    if (snapshot.captureEdit) await window.desktopPetals.temporaryFiles({ kind: 'finishCapture', id: pin.id });
    setEditing(false);
    setClosedEditRequest(snapshot.imageEditRequest);
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
    <PetalNoteContextMenu {...noteActions}>
      <ContentSurface
        kind={editing ? 'editor' : media && !collection ? 'media' : 'paper'}
        title={title}
        contextLabel={snapshot.temporary ? copy.temporary.title : `${copy.scope.current} · ${snapshot.libraryName}`}
        titlesVisible={snapshot.titlesVisible}
        className="content-surface--desktop absolute inset-2"
        compact={compact}
        headerDrag={headerDrag}
        style={appearanceStyle(pin.color)}
        leading={!compact && <PetalNoteOperations {...noteActions} />}
        tools={
          <ContentPinToolbar
            media={collection ? null : media}
            compact={compact}
            chromeRef={setChromeTarget}
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
        resize={<PinResizeHandle snapshot={snapshot} media={Boolean(media)} editing={editing} onError={onError} />}
      >
        {editing ? (
          <ImageEditorBoundary onClose={closeEditor}>
            <ImageEditor
              key={pin.id}
              id={pin.id}
              previewUrl={media?.mediaUrl}
              chromeTarget={chromeTarget}
              captureMode={Boolean(snapshot.captureEdit)}
              suspended={snapshot.suspended}
              onClose={closeEditor}
            />
          </ImageEditorBoundary>
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
            original={Boolean(snapshot.temporary)}
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
    </PetalNoteContextMenu>
  );
}

function pinTitle(pin: DesktopPin, snapshot: DesktopPetalSnapshot, locale: string, copy: DesktopPetalMessages) {
  return (
    (snapshot.temporary
      ? temporaryImageTitle(pin.title, snapshot.temporary.updatedAt, locale, copy.temporary)
      : petalLabel(pin.title, pin.preview)) || copy.board[pin.source.kind]
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

function canEditPinImage(snapshot: DesktopPetalSnapshot, media: PinMedia | null) {
  return Boolean(snapshot.temporary && media && ['image/png', 'image/jpeg'].includes(media.mimeType));
}

function ContentPinToolbar({
  media,
  compact,
  chromeRef,
  editing,
  onEdit,
  snapshot,
  actions,
  scale,
  motion,
  onMotion,
}: {
  media: PinMedia | null;
  compact: boolean;
  chromeRef(value: HTMLSpanElement | null): void;
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
      {editing && <span ref={chromeRef} className="flex items-center gap-0.5" />}
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
      {compact ? <PetalNoteOperations {...actions} compact /> : <NoteDisplayMenu scale={scale} actions={actions} />}
      {(editing || compact) && (
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

function PinResizeHandle({
  snapshot,
  media,
  editing,
  onError,
}: {
  snapshot: DesktopPetalSnapshot;
  media: boolean;
  editing: boolean;
  onError(reason: unknown): void;
}) {
  return (
    <div
      className={`content-surface__resize absolute right-0 bottom-0 z-35 size-7 ${media ? 'opacity-0 group-hover/content-surface:opacity-100 group-focus-within/content-surface:opacity-100 [@media(hover:none)]:opacity-100' : ''}`}
    >
      <NoteResizeHandle
        image={Boolean(snapshot.temporary && media && !editing)}
        disabled={snapshot.suspended || editing}
        onError={onError}
      />
    </div>
  );
}
