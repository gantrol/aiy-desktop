import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReadingSource, ReadingPosition } from '@/shared/contracts/creation-reading';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ReadingHtml } from '@/renderer/features/creation-reading/ReadingHtml';
import {
  ReadingText,
  type ReadingSelection,
  type ReadingReveal,
  type ReadingViewportPosition,
} from '@/renderer/features/creation-reading/ReadingText';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWorkspaceVisible } from '@/renderer/components/workspace/WorkspacePaneScope';

const ReadingPdf = lazy(() =>
  import('@/renderer/features/creation-reading/ReadingPdf').then((module) => ({ default: module.ReadingPdf })),
);
const ReadingEpub = lazy(() => import('./ReadingEpub').then((module) => ({ default: module.ReadingEpub })));
export function ReadingSourceView({
  source,
  spaceId,
  articleId,
  visible,
  previewRequest,
  onSelect,
  reveal,
  position,
  onPosition,
  onRevealFailed,
}: {
  source: ReadingSource;
  spaceId: string;
  articleId: string;
  visible: boolean;
  previewRequest: number;
  reveal?: ReadingReveal;
  position?: ReadingPosition;
  onPosition(position: ReadingPosition): void;
  onRevealFailed(): void;
  onSelect(value: ReadingSelection | null): void;
}) {
  const copy = useI18n().messages.creationReading;
  const workspaceVisible = useWorkspaceVisible();
  const active = workspaceVisible && visible;
  const session = useArticleEditorSession();
  const initialPosition = useRef(position).current;
  const reportPosition = useCallback(
    (value: ReadingViewportPosition) => onPosition({ ...value, sourceId: source.id }),
    [source.id, onPosition],
  );
  const navigation = { reveal, initialPosition, onPosition: reportPosition, onRevealFailed };
  const [bytes, setBytes] = useState<Uint8Array | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const extension = source.kind === 'FILE' ? source.file.extension : '';
  const supported = source.kind !== 'FILE' || ['.pdf', '.epub', '.txt', '.md'].includes(extension);
  const text = useMemo(
    () => (bytes && ['.txt', '.md'].includes(extension) ? new TextDecoder().decode(bytes) : ''),
    [bytes, extension],
  );
  useEffect(() => {
    if (!active || bytes || source.kind !== 'FILE' || !supported) return;
    let disposed = false;
    setBytes(null);
    setFailed(false);
    void (async () => {
      if (!(await session.flush('manual'))) throw new Error('READING_SAVE_FAILED');
      if (disposed) return null;
      return window.desktopApi.readingFileRead({ spaceId, articleId, sourceId: source.id });
    })()
      .then((value) => {
        if (!disposed) setBytes(value);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [active, bytes, source.id, source.kind, spaceId, articleId, retry, session, supported]);
  if (!supported)
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        {copy.formatUnavailable}
      </div>
    );
  if (source.kind === 'CONTENT')
    return <ReadingText text={source.text} location={{}} onSelect={onSelect} {...navigation} />;
  if (source.kind === 'HTML')
    return (
      <ReadingHtml
        file={source.file}
        visible={active && visible}
        previewRequest={previewRequest}
        onSelect={onSelect}
        {...navigation}
      />
    );
  if (failed)
    return (
      <div role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
        {copy.fileFailed}
        <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
          {copy.retry}
        </Button>
      </div>
    );
  const loading = (
    <div role="status" className="p-4 text-sm text-muted-foreground">
      {copy.loading}
    </div>
  );
  if (!bytes) return loading;
  return (
    <Suspense fallback={loading}>
      {source.file.extension === '.pdf' ? (
        <ReadingPdf active={active} bytes={bytes} onSelect={onSelect} {...navigation} />
      ) : source.file.extension === '.epub' ? (
        <ReadingEpub active={active} bytes={bytes} onSelect={onSelect} {...navigation} />
      ) : (
        <ReadingText text={text} location={{}} onSelect={onSelect} {...navigation} />
      )}
    </Suspense>
  );
}
