import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GripHorizontal, Minus, Plus } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageEditCanvas } from '@/renderer/features/image-editing/ImageEditCanvas';
import { ImageEditToolbar } from '@/renderer/features/image-editing/ImageEditToolbar';
import { ImageEditParameters } from '@/renderer/features/image-editing/ImageEditParameters';
import { ImageEditSession } from '@/renderer/features/image-editing/image-edit-session';
import { loadEditImage } from '@/renderer/features/image-editing/image-edit-export';
import { useImageEditPersistence } from '@/renderer/features/image-editing/use-image-edit-persistence';
import { usePetalDrag } from '@/renderer/features/desktop-petals/use-petal-drag';
import type { ImageEditMark } from '@/shared/contracts/image-edit';
import type { ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';
import { petalErrorCode, petalErrorText } from '@/shared/petal-errors';
import { readCssToken } from '@/renderer/lib/tokens';
import { useImagePrivacy } from '@/renderer/features/image-editing/use-image-privacy';
import { ImagePrivacyPanel } from '@/renderer/features/image-editing/ImagePrivacyPanel';

export function ImageEditor({ id, suspended, onClose }: { id: string; suspended: boolean; onClose(): void }) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const [loaded, setLoaded] = useState<{ session: ImageEditSession; image: HTMLImageElement } | null>(null);
  const [error, setError] = useState<'load' | 'unsupported' | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let session: ImageEditSession | undefined;
    void window.desktopPetals
      .imageEdit({ kind: 'load' })
      .then(async (snapshot) => {
        const image = await loadEditImage(snapshot.sourceUrl, abort.signal);
        abort.signal.throwIfAborted();
        if (image.naturalWidth !== snapshot.document.width || image.naturalHeight !== snapshot.document.height)
          throw new Error('IMAGE_EDIT_DIMENSIONS_CHANGED');
        session = new ImageEditSession(snapshot, window.desktopPetals.imageEdit);
        setLoaded({ session, image });
        setError(null);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(petalErrorCode(reason) === 'invalidSettings' ? 'unsupported' : 'load');
      });
    return () => {
      abort.abort();
      session?.dispose();
    };
  }, [id, retry]);
  if (!loaded)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-3">
        {error && (
          <>
            <span role="alert" className="text-xs">
              {error === 'unsupported' ? copy.unsupported : copy.loadFailed}
            </span>
            <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
              {copy.retry}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    );
  return <ImageEditorWorkspace {...loaded} id={id} suspended={suspended} onClose={onClose} />;
}

function ImageEditorWorkspace({
  session,
  image,
  id,
  suspended,
  onClose,
}: {
  session: ImageEditSession;
  image: HTMLImageElement;
  id: string;
  suspended: boolean;
  onClose(): void;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tool, setTool] = useState<ImageEditTool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [style, setStyle] = useState(() => ({ color: readCssToken('--selected-foreground'), stroke: 4, fontSize: 32 }));
  const [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState<number | null>(null);
  const { error, setError, finish, cancel, composing } = useImageEditPersistence(session, image, id, onClose);
  const privacy = useImagePrivacy(session, image, suspended || state.locked);
  const workspace = useRef<HTMLDivElement>(null);
  const privacyWasOpen = useRef(false);
  useEffect(() => {
    if (privacyWasOpen.current && !privacy.open)
      workspace.current?.querySelector<HTMLButtonElement>('[data-image-tools]')?.focus();
    privacyWasOpen.current = privacy.open;
  }, [privacy.open]);
  const drag = usePetalDrag(undefined, (reason) => setError(petalErrorText(reason, messages.desktopPetals.errors)));
  const patchMark = (patch: Partial<ImageEditMark>) =>
    session.change({
      ...state.document,
      marks: state.document.marks.map((mark) => (mark.id === selected ? { ...mark, ...patch } : mark)),
    });
  const onAction = (action: 'rotate' | 'flipX' | 'flipY' | 'delete' | 'duplicate' | 'front' | 'back') => {
    const document = state.document,
      marks = [...document.marks],
      index = marks.findIndex((mark) => mark.id === selected);
    if (action === 'rotate') {
      session.change({ ...document, rotation: (document.rotation + 1) % 4 });
      return;
    }
    if (action === 'flipX' || action === 'flipY') {
      session.change({ ...document, [action]: !document[action] });
      return;
    }
    if (index < 0) return;
    if (action === 'delete') {
      marks.splice(index, 1);
      setSelected(null);
    }
    if (action === 'duplicate') {
      const mark = { ...marks[index], id: crypto.randomUUID(), x: marks[index].x + 12, y: marks[index].y + 12 };
      marks.push(mark);
      setSelected(mark.id);
    }
    if (action === 'front' && index < marks.length - 1)
      [marks[index], marks[index + 1]] = [marks[index + 1], marks[index]];
    if (action === 'back' && index > 0) [marks[index], marks[index - 1]] = [marks[index - 1], marks[index]];
    session.change({ ...document, marks });
  };
  const disabled = suspended || state.locked || Boolean(privacy.preview);
  return (
    <div
      ref={workspace}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (
          disabled ||
          original ||
          event.nativeEvent.isComposing ||
          (event.target as HTMLElement).closest('input, textarea, [contenteditable=true], [role=menu], [role=listbox]')
        )
          return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) session.redo();
          else session.undo();
        } else if (event.key === 'Escape') setSelected(null);
        else if (selected && ['Delete', 'Backspace'].includes(event.key)) {
          event.preventDefault();
          onAction('delete');
        } else if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          const mark = state.document.marks.find((m) => m.id === selected);
          if (!mark) return;
          const step = event.shiftKey ? 10 : 1;
          patchMark({
            x: mark.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
            y: mark.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
          });
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 px-2 py-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-8 cursor-move"
          aria-label={copy.move}
          disabled={disabled}
          {...drag.handlers}
        >
          <GripHorizontal className="size-4" />
        </Button>
        <Button
          size="sm"
          variant={original ? 'secondary' : 'ghost'}
          aria-pressed={original}
          onClick={() => setOriginal(!original)}
        >
          {copy.original}
        </Button>
        <Button size="sm" variant={zoom === null ? 'secondary' : 'ghost'} onClick={() => setZoom(null)}>
          {copy.fit}
        </Button>
        <Button size="sm" variant={zoom === 1 ? 'secondary' : 'ghost'} onClick={() => setZoom(1)}>
          {copy.actual}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={copy.zoomOut}
          onClick={() => setZoom(Math.max(0.1, (zoom ?? 1) / 1.25))}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={copy.zoomIn}
          onClick={() => setZoom(Math.min(4, (zoom ?? 1) * 1.25))}
        >
          <Plus className="size-4" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground" role="status">
          {state.error ? copy.unsaved : state.saving || state.dirty ? copy.saving : copy.saved}
        </span>
        {state.error && (
          <Button size="sm" variant="ghost" onClick={() => void session.checkpoint().catch(() => undefined)}>
            {copy.retry}
          </Button>
        )}
      </div>
      <ImageEditCanvas
        document={privacy.preview ?? state.document}
        sourceUrl={session.sourceUrl}
        tool={privacy.preview ? 'select' : tool}
        selected={privacy.preview ? null : selected}
        {...style}
        zoom={zoom}
        disabled={disabled}
        original={original}
        label={copy.canvas}
        onSelect={setSelected}
        onChange={session.change}
      />
      {privacy.open && <ImagePrivacyPanel privacy={privacy} disabled={suspended || state.locked || original} />}
      <ImageEditParameters
        document={state.document}
        tool={tool}
        selected={selected}
        {...style}
        disabled={disabled || original}
        onSelect={setSelected}
        onChange={session.change}
        onComposing={(value) => {
          composing.current = value;
        }}
        onStyle={(patch) => {
          setStyle({ ...style, ...patch });
          if (selected) patchMark(patch);
        }}
      />
      {error && (
        <span role="alert" className="px-2 text-xs text-destructive">
          {error}
        </span>
      )}
      <ImageEditToolbar
        tool={tool}
        disabled={disabled || original}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        selected={Boolean(selected)}
        onTool={(value) => {
          setTool(value);
          setSelected(null);
        }}
        onUndo={session.undo}
        onRedo={session.redo}
        onPrivacy={() => {
          setSelected(null);
          privacy.show();
        }}
        onAction={onAction}
        onCancel={cancel}
        onFinish={finish}
      />
    </div>
  );
}
