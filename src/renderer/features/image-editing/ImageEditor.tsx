import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ImageEditViewControls } from '@/renderer/features/image-editing/ImageEditViewControls';
import { fitTextHeight } from '@/renderer/features/image-editing/image-edit-text';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageEditCanvas } from '@/renderer/features/image-editing/ImageEditCanvas';
import { ImageEditToolbar } from '@/renderer/features/image-editing/ImageEditToolbar';
import { ImageEditParameters } from '@/renderer/features/image-editing/ImageEditParameters';
import { ImageEditSession } from '@/renderer/features/image-editing/image-edit-session';
import { loadEditImage } from '@/renderer/features/image-editing/image-edit-export';
import { useImageEditPersistence } from '@/renderer/features/image-editing/use-image-edit-persistence';
import { emptyImageEdit, type ImageEditMark } from '@/shared/contracts/image-edit';
import type { ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';
import { petalErrorCode } from '@/shared/petal-errors';
import { readCssToken } from '@/renderer/lib/tokens';
import { useImagePrivacy } from '@/renderer/features/image-editing/use-image-privacy';
import { ImagePrivacyPanel } from '@/renderer/features/image-editing/ImagePrivacyPanel';
import { ImageRecognitionDialog } from '@/renderer/features/image-editing/ImageRecognitionDialog';

export function ImageEditor({
  id,
  previewUrl,
  chromeTarget,
  captureMode = false,
  suspended,
  onClose,
}: {
  id: string;
  previewUrl?: string;
  chromeTarget?: HTMLElement | null;
  captureMode?: boolean;
  suspended: boolean;
  onClose(): void | Promise<void>;
}) {
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
      <div
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface p-3"
        aria-busy={!error}
      >
        {previewUrl && <img src={previewUrl} alt="" draggable={false} className="min-h-0 flex-1 object-contain" />}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void Promise.resolve(onClose()).catch(() => setError('load'))}
          >
            {copy.cancel}
          </Button>
        </div>
      </div>
    );
  return (
    <ImageEditorWorkspace
      {...loaded}
      id={id}
      chromeTarget={chromeTarget}
      captureMode={captureMode}
      suspended={suspended}
      onClose={onClose}
    />
  );
}

function ImageEditorWorkspace({
  session,
  image,
  id,
  chromeTarget,
  captureMode = false,
  suspended,
  onClose,
}: {
  session: ImageEditSession;
  image: HTMLImageElement;
  id: string;
  chromeTarget?: HTMLElement | null;
  captureMode?: boolean;
  suspended: boolean;
  onClose(): void | Promise<void>;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tool, setTool] = useState<ImageEditTool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState<'ocr' | 'qr' | null>(null);
  const [style, setStyle] = useState(() => ({
    color: readCssToken('--selected-foreground'),
    stroke: 4,
    fontSize: 32,
    fontFamily: 'sans-serif' as NonNullable<ImageEditMark['fontFamily']>,
  }));
  const [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState<number | null>(null);
  const { error, setError, finish, cancel, leave, composing } = useImageEditPersistence(session, image, id, onClose);
  const rasterError = useCallback(() => setError(copy.failed), [setError, copy.failed]);
  const privacy = useImagePrivacy(session, image, suspended || state.locked);
  const workspace = useRef<HTMLDivElement>(null);
  const privacyWasOpen = useRef(false);
  useEffect(() => {
    if (privacyWasOpen.current && !privacy.open)
      workspace.current?.querySelector<HTMLButtonElement>('[data-image-tools]')?.focus();
    privacyWasOpen.current = privacy.open;
  }, [privacy.open]);
  const onComposing = useCallback(
    (value: boolean) => {
      composing.current = value;
    },
    [composing],
  );
  const patchMark = (patch: Partial<ImageEditMark>) =>
    session.change({
      ...state.document,
      marks: state.document.marks.map((mark) => {
        if (mark.id !== selected) return mark;
        const next = { ...mark, ...patch };
        return next.kind === 'text' || next.kind === 'number' ? fitTextHeight(next) : next;
      }),
    });
  const onAction = (
    action: 'rotate' | 'flipX' | 'flipY' | 'delete' | 'duplicate' | 'front' | 'back' | 'clear' | 'restore',
  ) => {
    const document = state.document,
      marks = [...document.marks],
      index = marks.findIndex((mark) => mark.id === selected);
    if (action === 'clear' || action === 'restore') {
      session.change(action === 'clear' ? { ...document, marks: [] } : emptyImageEdit(document.width, document.height));
      setSelected(null);
      return;
    }
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
  const viewControls = (
    <ImageEditViewControls
      document={state.document}
      selected={selected}
      zoom={zoom}
      original={original}
      disabled={disabled}
      saving={state.saving || state.dirty}
      error={state.error}
      onZoom={setZoom}
      onOriginal={setOriginal}
      onSelect={setSelected}
      onChange={session.change}
      onRetry={() => void session.checkpoint().catch(() => undefined)}
    />
  );
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
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (selected) setSelected(null);
          else leave();
        } else if (selected && ['Delete', 'Backspace'].includes(event.key)) {
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
      {chromeTarget ? (
        createPortal(viewControls, chromeTarget)
      ) : (
        <div className="flex justify-end px-2">{viewControls}</div>
      )}
      <ImageEditCanvas
        document={privacy.preview ?? state.document}
        sourceUrl={session.sourceUrl}
        image={image}
        onRasterError={rasterError}
        tool={privacy.preview ? 'select' : tool}
        selected={privacy.preview ? null : selected}
        {...style}
        zoom={zoom}
        disabled={disabled}
        original={original}
        label={copy.canvas}
        onSelect={setSelected}
        onChange={session.change}
        onTextChange={session.changeText}
        onComposing={onComposing}
        parameters={
          (selected || !['select', 'pan'].includes(tool)) && (
            <ImageEditParameters
              document={state.document}
              tool={tool}
              selected={selected}
              {...style}
              disabled={disabled || original}
              onSelect={setSelected}
              onChange={session.change}
              onStyle={(patch) => {
                setStyle({ ...style, ...patch, fontFamily: patch.fontFamily ?? style.fontFamily });
                if (selected) patchMark(patch);
              }}
            />
          )
        }
      />
      {privacy.open && <ImagePrivacyPanel privacy={privacy} disabled={suspended || state.locked || original} />}
      {error && (
        <span role="alert" className="px-2 text-xs text-destructive">
          {error}
        </span>
      )}
      <ImageEditToolbar
        captureMode={captureMode}
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
        onRecognize={setRecognizing}
        onAction={onAction}
        onCancel={cancel}
        onFinish={finish}
      />
      {recognizing && (
        <ImageRecognitionDialog
          mode={recognizing}
          image={image}
          document={state.document}
          onClose={() => setRecognizing(null)}
        />
      )}
    </div>
  );
}
