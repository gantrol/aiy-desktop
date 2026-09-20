import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  CropIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  Redo2Icon,
  RotateCcwIcon,
  ImagesIcon,
  StarIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { ArticleCoverDialog } from '@/renderer/components/creator/article-editor/ArticleCoverDialog';
import { ArticleCoverRatioInfo } from '@/renderer/components/creator/article-editor/ArticleCoverRatioInfo';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { useArticleCoverWorkspace } from '@/renderer/components/creator/article-editor/ArticleCoverWorkspace';
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
import { cn } from '@/renderer/lib/utils';
import { ARTICLE_COVER_RATIOS, articleCoverAspectRatio, type ArticleCoverRatio } from '@/shared/article-covers';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';

export const articleCoverSourceDragType = 'application/x-aiy-article-cover-source';

type EditingCover = { ratio: ArticleCoverRatio; source?: VideoDocumentEditorImageImport };

export function ArticleMediaCover({ media }: { media: readonly VideoDocumentRevisionMediaDto[] }) {
  const copy = useI18n().messages.contentEditor;
  const session = useArticleEditorSession();
  const workspace = useArticleCoverWorkspace();
  const cover = useArticleEditorSessionSelector((state) => state.draft.metadata.coverAssetId);
  const variants = useArticleEditorSessionSelector((state) => state.draft.metadata.coverVariants);
  // A history move may restore an identical media list while changing available undo actions.
  useArticleEditorSessionSelector((state) => state.draft.sequence);
  const [editing, setEditing] = useState<EditingCover | null>(null);
  const [dragOver, setDragOver] = useState<ArticleCoverRatio | null>(null);
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
    setDragOver(null);
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
            const generateLabel = copy.coverEditor.generateRatio.replace('{ratio}', ratio);
            const preview = (
              <Button
                type="button"
                variant="ghost"
                aria-label={`${copy.coverEditor.edit} ${ratio}`}
                title={`${copy.coverEditor.edit} ${ratio}`}
                className={cn(
                  'group relative mx-auto flex h-20 overflow-hidden rounded-sm bg-surface-sunken p-0',
                  dragOver === ratio && 'ring-2 ring-ring ring-inset',
                )}
                style={{ width: articleCoverAspectRatio(ratio) * 80 }}
                disabled={Boolean(dropping)}
                onClick={() => setEditing({ ratio })}
                onDragOver={(event) => {
                  if (!accepts(event.dataTransfer) || working.current) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'copy';
                  setDragOver(ratio);
                }}
                onDragLeave={(event) => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
                    setDragOver(null);
                }}
                onDrop={(event) => void drop(event, ratio)}
              >
                {dropping === ratio ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : asset ? (
                  <>
                    <img
                      src={mediaThumbnailUrl({ id: asset.assetId }, 192)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                      draggable={false}
                    />
                    <CropIcon className="absolute right-1 bottom-1 size-5 rounded-sm bg-background/90 p-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </>
                ) : (
                  <ImagePlusIcon className="size-4 text-muted-foreground" />
                )}
              </Button>
            );
            return (
              <div
                key={ratio}
                className="shrink-0"
                style={{ width: Math.max(80, articleCoverAspectRatio(ratio) * 80) }}
              >
                {id ? (
                  <AssetFileContextMenu
                    assetId={id}
                    actions={[
                      {
                        id: 'crop-cover',
                        label: copy.coverEditor.edit,
                        icon: CropIcon,
                        onSelect: () => setEditing({ ratio }),
                      },
                      {
                        id: 'generate-cover',
                        label: generateLabel,
                        icon: ImagePlusIcon,
                        disabled: !workspace.canGenerate || workspace.generating,
                        onSelect: () => void workspace.onGenerate(ratio),
                      },
                      {
                        id: 'use-shared-cover',
                        label: copy.coverEditor.setDefault,
                        icon: StarIcon,
                        disabled: !asset || cover === id,
                        onSelect: () => session.coverChanged(id),
                      },
                    ]}
                  >
                    {preview}
                  </AssetFileContextMenu>
                ) : (
                  preview
                )}
                <div className="mt-1 flex items-center justify-between gap-1 text-xs tabular-nums text-muted-foreground">
                  <div className="flex items-center gap-0.5">
                    <span>{ratio}</span>
                    <ArticleCoverRatioInfo ratio={ratio} />
                  </div>
                  {variant && (
                    <ArticleHeaderIconButton
                      variant="ghost"
                      className="size-6"
                      label={`${copy.coverEditor.useDefault} ${ratio}`}
                      onClick={() => session.coverVariantChanged(ratio, null)}
                    >
                      <RotateCcwIcon className="size-3" />
                    </ArticleHeaderIconButton>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  <ArticleHeaderIconButton
                    variant="ghost"
                    label={`${copy.coverEditor.chooseImage} ${ratio}`}
                    onClick={() => setEditing({ ratio })}
                  >
                    <ImagesIcon className="size-3.5" />
                  </ArticleHeaderIconButton>
                  <ArticleHeaderIconButton
                    variant="ghost"
                    label={generateLabel}
                    disabled={!workspace.canGenerate || workspace.generating || Boolean(dropping)}
                    onClick={() => void workspace.onGenerate(ratio)}
                  >
                    <ImagePlusIcon className="size-3.5" />
                  </ArticleHeaderIconButton>
                </div>
              </div>
            );
          })}
        </div>
        {error && (
          <div role="alert" className="text-xs text-destructive">
            {error}
          </div>
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
