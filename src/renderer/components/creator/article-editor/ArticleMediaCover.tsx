import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Redo2Icon, Undo2Icon, XIcon, TypeIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ArticleTextCoverDialog } from '@/renderer/components/creator/article-editor/ArticleTextCoverDialog';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { ArticleCoverSlot } from '@/renderer/components/creator/article-editor/ArticleCoverSlot';
import { ArticleCoverDialog } from '@/renderer/components/creator/article-editor/ArticleCoverDialog';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  importVideoDocumentEditorImage,
  videoDocumentEditorImageFromAsset,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { VideoDocumentEditorImageImport } from '@/renderer/features/content-editor/contentImageAsset';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ARTICLE_COVER_RATIOS, type ArticleCoverRatio } from '@/shared/article-covers';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';

export const articleCoverSourceDragType = 'application/x-aiy-article-cover-source';

type EditingCover = { ratio: ArticleCoverRatio; source?: VideoDocumentEditorImageImport };

export function ArticleMediaCover({ media }: { media: readonly VideoDocumentRevisionMediaDto[] }) {
  const copy = useI18n().messages.contentEditor;
  const session = useArticleEditorSession();
  const cover = useArticleEditorSessionSelector((state) => state.draft.metadata.coverAssetId);
  const variants = useArticleEditorSessionSelector((state) => state.draft.metadata.coverVariants);
  // A history move may restore an identical media list while changing available undo actions.
  useArticleEditorSessionSelector((state) => state.draft.sequence);
  const [editing, setEditing] = useState<EditingCover | null>(null);
  const [textCover, setTextCover] = useState<ArticleCoverRatio | 'choose' | null>(null);
  const [dropping, setDropping] = useState<ArticleCoverRatio | null>(null);
  const [error, setError] = useState('');
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function accepts(data: DataTransfer) {
    return data.types.includes(articleCoverSourceDragType) || hasMaterialsDrag(data) || data.types.includes('Files');
  }
  async function drop(event: DragEvent, ratio: ArticleCoverRatio) {
    if (!accepts(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (working.current) return;
    const sourceId = event.dataTransfer.getData(articleCoverSourceDragType);
    const targets = readMaterialsDrag(event.dataTransfer);
    const files = [...event.dataTransfer.files];
    const identity = session.getEditorSessionIdentity();
    working.current = true;
    setDropping(ratio);
    setError('');
    try {
      let source: VideoDocumentEditorImageImport;
      if (sourceId) {
        const asset = media.find((item) => item.assetId === sourceId && item.mimeType.startsWith('image/'));
        const binding = session.captureSnapshot().mediaBindings.find((item) => item.assetId === sourceId);
        if (!asset || !binding) throw new Error('COVER_SOURCE_UNAVAILABLE');
        source = {
          media: asset,
          binding: { ...binding, kind: 'IMAGE', timestampMs: null, endTimestampMs: null, posterAssetId: null },
        };
      } else if (targets.length === 1) {
        const assets = await window.desktopApi.materialImageAssetsResolve({ targets });
        if (assets.length !== 1) throw new Error('COVER_SOURCE_UNAVAILABLE');
        source = videoDocumentEditorImageFromAsset(assets[0]);
      } else if (targets.length === 0 && files.length === 1) {
        source = await importVideoDocumentEditorImage(files[0], 'DROP');
      } else throw new Error('COVER_REQUIRES_ONE_IMAGE');
      if (mounted.current && identity === session.getEditorSessionIdentity()) setEditing({ ratio, source });
    } catch {
      if (mounted.current) setError(copy.imageImportFailed);
    } finally {
      working.current = false;
      if (mounted.current) setDropping(null);
    }
  }
  return (
    <TooltipProvider delayDuration={300}>
      <section
        aria-label={copy.articleCover}
        className="min-w-0 shrink-0 border-b pb-3"
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          const key = event.key.toLowerCase();
          if (key !== 'z' && key !== 'y') return;
          event.preventDefault();
          event.stopPropagation();
          if (key === 'y' || event.shiftKey) session.redoCover();
          else session.undoCover();
        }}
      >
        <div className="mb-2 flex h-7 items-center justify-between gap-2">
          <span className="text-xs font-medium">{copy.articleCover}</span>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={Boolean(dropping)}
              onClick={() => setTextCover('choose')}
            >
              <TypeIcon className="size-3.5" />
              {copy.textCover.generate}
            </Button>
            <ArticleHeaderIconButton
              variant="ghost"
              label={copy.coverEditor.undo}
              disabled={!session.canUndoCover() || Boolean(dropping)}
              onClick={() => session.undoCover()}
            >
              <Undo2Icon className="size-3.5" />
            </ArticleHeaderIconButton>
            <ArticleHeaderIconButton
              variant="ghost"
              label={copy.coverEditor.redo}
              disabled={!session.canRedoCover() || Boolean(dropping)}
              onClick={() => session.redoCover()}
            >
              <Redo2Icon className="size-3.5" />
            </ArticleHeaderIconButton>
            {Boolean(cover || variants?.length) && (
              <ArticleHeaderIconButton
                variant="ghost"
                label={copy.removeArticleCover}
                onClick={() => session.coverChanged(null)}
              >
                <XIcon className="size-3.5" />
              </ArticleHeaderIconButton>
            )}
          </div>
        </div>
        <div className="flex items-start gap-3 overflow-x-auto pb-1">
          {ARTICLE_COVER_RATIOS.map((ratio) => {
            const variant = variants?.find((item) => item.ratio === ratio);
            const id = variant?.assetId ?? cover;
            const asset = media.find((item) => item.assetId === id);
            return (
              <ArticleCoverSlot
                key={ratio}
                ratio={ratio}
                assetId={id}
                asset={asset}
                hasVariant={Boolean(variant)}
                isDefault={cover === id}
                dropping={dropping}
                acceptsDrop={(data) => !working.current && accepts(data)}
                onDrop={drop}
                onEdit={() => setEditing({ ratio })}
                onGenerateText={() => setTextCover(ratio)}
              />
            );
          })}
        </div>
        {error && (
          <div role="alert" className="text-xs text-destructive">
            {error}
          </div>
        )}
        {textCover && (
          <ArticleTextCoverDialog
            ratio={textCover === 'choose' ? undefined : textCover}
            onClose={() => setTextCover(null)}
          />
        )}
        {editing && (
          <ArticleCoverDialog
            key={`${editing.ratio}:${editing.source?.media.assetId ?? ''}`}
            ratio={editing.ratio}
            variant={variants?.find((item) => item.ratio === editing.ratio)}
            defaultAssetId={cover}
            media={media}
            initialSource={editing.source}
            onClose={() => setEditing(null)}
          />
        )}
      </section>
    </TooltipProvider>
  );
}
