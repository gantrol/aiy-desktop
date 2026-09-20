import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ImagePlusIcon, LoaderCircleIcon, RotateCcwIcon } from 'lucide-react';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useArticleCoverWorkspace } from '@/renderer/components/creator/article-editor/ArticleCoverWorkspace';
import { ArticleCoverRatioInfo } from '@/renderer/components/creator/article-editor/ArticleCoverRatioInfo';
import { videoDocumentEditorImageFromAsset } from '@/renderer/features/content-editor/contentImageAsset';
import { Input } from '@/renderer/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import { ArticleCoverCropPreview } from '@/renderer/components/creator/article-editor/ArticleCoverCropPreview';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { importVideoDocumentEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { VideoDocumentEditorImageImport } from '@/renderer/features/content-editor/contentImageAsset';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  articleCoverCropRect,
  type ArticleCoverCrop,
  type ArticleCoverRatio,
  type ArticleCoverVariant,
} from '@/shared/article-covers';
import type { ArticleContentInput, VideoDocumentRevisionMediaDto } from '@/shared/contracts';

const centeredCrop: ArticleCoverCrop = { x: 0.5, y: 0.5, zoom: 1 };

async function cropCover(image: HTMLImageElement, ratio: ArticleCoverRatio, crop: ArticleCoverCrop) {
  const rect = articleCoverCropRect(image.naturalWidth, image.naturalHeight, ratio, crop);
  // Covers are bounded output assets; the original remains available for a later crop.
  const scale = Math.min(1, 4096 / Math.max(rect.width, rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('COVER_CANVAS_UNAVAILABLE');
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('COVER_CROP_FAILED'))), 'image/png'),
    );
    return await importVideoDocumentEditorImage(
      new File([blob], `cover-${ratio.replace(':', '-')}.png`, { type: 'image/png' }),
      'UPLOAD',
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function ArticleCoverDialog({
  ratio,
  variant,
  defaultAssetId,
  media,
  initialSource,
  onClose,
}: {
  ratio: ArticleCoverRatio;
  variant?: ArticleCoverVariant;
  defaultAssetId: string | null;
  media: readonly VideoDocumentRevisionMediaDto[];
  initialSource?: VideoDocumentEditorImageImport;
  onClose(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor.coverEditor;
  const session = useArticleEditorSession();
  const workspace = useArticleCoverWorkspace();
  const projectImports = useMemo(
    () =>
      workspace.projectAssets
        .filter((asset) => asset.mimeType.startsWith('image/'))
        .map(videoDocumentEditorImageFromAsset),
    [workspace.projectAssets],
  );
  const [collection, setCollection] = useState<'article' | 'project'>('article');
  const [replaceAll, setReplaceAll] = useState(false);
  const mounted = useRef(true);
  const initialVersion = useRef(session.getEditorSessionIdentity());
  const initialCovers = useRef(session.captureSnapshot());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [sourceId, setSourceId] = useState(initialSource?.media.assetId ?? variant?.sourceAssetId ?? defaultAssetId);
  const [crop, setCrop] = useState(initialSource ? centeredCrop : (variant?.crop ?? centeredCrop));
  const [uploads, setUploads] = useState<VideoDocumentEditorImageImport[]>(initialSource ? [initialSource] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const choices = [
    ...new Map(
      [...media, ...projectImports.map((image) => image.media), ...uploads.map((image) => image.media)]
        .filter((asset) => asset.mimeType.startsWith('image/'))
        .map((asset) => [asset.assetId, asset]),
    ).values(),
  ];
  const source = choices.find((asset) => asset.assetId === sourceId);
  const visibleChoices =
    collection === 'project'
      ? projectImports.map((image) => image.media)
      : choices.filter(
          (asset) =>
            media.some((item) => item.assetId === asset.assetId) ||
            uploads.some((item) => item.media.assetId === asset.assetId),
        );

  function selectSource(id: string) {
    if (id === sourceId) return;
    setSourceId(id);
    setCrop(centeredCrop);
    setLoadedUrl(null);
    setError('');
  }

  async function upload(file: File) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const image = await importVideoDocumentEditorImage(file, 'UPLOAD');
      if (!mounted.current || initialVersion.current !== session.getEditorSessionIdentity()) return;
      setCollection('article');
      setUploads((current) => [...current, image]);
      selectSource(image.media.assetId);
    } catch {
      setError(messages.contentEditor.imageImportFailed);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function save() {
    const image = imageRef.current;
    if (working.current || !source || !image || loadedUrl !== source.mediaUrl) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      if (
        !replaceAll &&
        variant?.sourceAssetId === source.assetId &&
        variant.crop.x === crop.x &&
        variant.crop.y === crop.y &&
        variant.crop.zoom === crop.zoom &&
        media.some((asset) => asset.assetId === variant.assetId)
      ) {
        onClose();
        return;
      }
      const rect = articleCoverCropRect(image.naturalWidth, image.naturalHeight, ratio, crop);
      const wholeImage =
        Math.abs(rect.width - image.naturalWidth) < 0.01 && Math.abs(rect.height - image.naturalHeight) < 0.01;
      const result = wholeImage ? null : await cropCover(image, ratio, crop);
      if (!mounted.current || initialVersion.current !== session.getEditorSessionIdentity()) return;
      if (
        coverSelectionKey(initialCovers.current, replaceAll ? undefined : ratio) !==
        coverSelectionKey(session.captureSnapshot(), replaceAll ? undefined : ratio)
      )
        throw new Error('COVER_CHANGED');
      const sourceImport = [...uploads, ...projectImports].find((item) => item.media.assetId === source.assetId);
      const nextVariant = {
        ratio,
        assetId: result?.media.assetId ?? source.assetId,
        sourceAssetId: source.assetId,
        crop,
      };
      const imported = [...(sourceImport ? [sourceImport] : []), ...(result ? [result] : [])];
      if (
        !(replaceAll
          ? session.sharedCoverVariantChanged(nextVariant, imported)
          : session.coverVariantChanged(ratio, nextVariant, imported))
      )
        throw new Error('COVER_SAVE_FAILED');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error && reason.message === 'COVER_CHANGED' ? copy.changed : copy.failed);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !working.current) onClose();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto rounded-sm"
          aria-describedby={undefined}
          showCloseButton={!busy}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <DialogTitle>
              {messages.contentEditor.articleCover} · {ratio}
            </DialogTitle>
            <ArticleCoverRatioInfo ratio={ratio} />
          </div>
          <ArticleCoverSources
            collection={collection}
            setCollection={setCollection}
            visibleChoices={visibleChoices}
            sourceId={sourceId}
            busy={busy}
            inputRef={inputRef}
            upload={upload}
            selectSource={selectSource}
          />
          {source ? (
            <ArticleCoverCropPreview
              key={source.assetId}
              source={source}
              ratio={ratio}
              crop={crop}
              disabled={busy}
              imageRef={imageRef}
              onChange={setCrop}
              onLoad={() => setLoadedUrl(source.mediaUrl)}
              onError={() => {
                setLoadedUrl(null);
                setError(messages.contentEditor.imageUnavailable);
              }}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="h-48 rounded-sm bg-surface-sunken"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon className="size-5" />
              {copy.chooseImage}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={replaceAll}
                  disabled={busy}
                  onCheckedChange={(checked) => setReplaceAll(checked === true)}
                />
                {copy.replaceAll}
              </label>
            </TooltipTrigger>
            <TooltipContent>{copy.replaceAllHint}</TooltipContent>
          </Tooltip>
          {error && (
            <div role="alert" className="text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy || !source} onClick={() => setCrop(centeredCrop)}>
              <RotateCcwIcon className="size-4" />
              {copy.resetCrop}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={busy || !source || loadedUrl !== source.mediaUrl}
              onClick={() => void save()}
            >
              {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {copy.apply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function ArticleCoverSources({
  collection,
  setCollection,
  visibleChoices,
  sourceId,
  busy,
  inputRef,
  upload,
  selectSource,
}: {
  collection: 'article' | 'project';
  setCollection(value: 'article' | 'project'): void;
  visibleChoices: readonly VideoDocumentRevisionMediaDto[];
  sourceId: string | null;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  upload(file: File): Promise<void>;
  selectSource(id: string): void;
}) {
  const copy = useI18n().messages.contentEditor.coverEditor;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1" role="group" aria-label={copy.chooseImage}>
        <Button
          type="button"
          size="sm"
          variant={collection === 'article' ? 'secondary' : 'ghost'}
          disabled={busy}
          aria-pressed={collection === 'article'}
          onClick={() => setCollection('article')}
        >
          {copy.thisArticle}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={collection === 'project' ? 'secondary' : 'ghost'}
          disabled={busy}
          aria-pressed={collection === 'project'}
          onClick={() => setCollection('project')}
        >
          {copy.projectImages}
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-1" aria-label={copy.chooseImage}>
          {collection === 'project' && !visibleChoices.length && (
            <span role="status" className="self-center px-1 text-xs text-muted-foreground">
              {copy.noProjectImages}
            </span>
          )}
          {visibleChoices.map((asset, index) => (
            <Button
              key={asset.assetId}
              type="button"
              variant="ghost"
              disabled={busy}
              aria-pressed={sourceId === asset.assetId}
              aria-label={`${copy.chooseImage} ${index + 1}`}
              className={cn(
                'size-14 shrink-0 overflow-hidden rounded-sm p-0',
                sourceId === asset.assetId && 'ring-2 ring-ring',
              )}
              onClick={() => selectSource(asset.assetId)}
            >
              <img
                src={mediaThumbnailUrl({ id: asset.assetId }, 192)}
                alt=""
                loading="lazy"
                className="size-full object-contain"
              />
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={busy}
          aria-label={copy.upload}
          title={copy.upload}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlusIcon className="size-4" />
        </Button>
        <Input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}

function coverSelectionKey(content: ArticleContentInput, ratio?: ArticleCoverRatio) {
  return JSON.stringify([
    content.coverAssetId,
    ratio ? content.coverVariants?.find((variant) => variant.ratio === ratio) : content.coverVariants,
  ]);
}
