import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { AssetDto, AssetFileRevealContext, TermListItem } from '@/shared/contracts';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import { CloseIcon, DictionaryIcon, ImageIcon } from '@/renderer/icons';
import { readSingleImageAssetDrag } from '@/renderer/components/albums/albumDrag';
import { TermPreviewTooltip } from '@/renderer/components/media/TermPreviewTooltip';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { MediaPreviewDialog } from '@/renderer/components/media/MediaPreviewDialog';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { AppliedWordPalette, CreatorPromptResolution } from '@/renderer/components/creator/utils';

interface Props {
  assets: AssetDto[];
  imageImporting?: boolean;
  promptResolution: CreatorPromptResolution;
  removeLabel: string;
  onAssetsChange(assets: AssetDto[]): void;
  onRemoveAsset(id: string): void;
  onRemovePalette(id: string): void;
  onRemoveTerm(term: TermListItem): void;
  onOpenPalette(id: string): void;
  onOpenTerm(term: TermListItem): void;
  notify(message: string): void;
  revealContext?: AssetFileRevealContext;
  hidePromptMaterials?: boolean;
}

function reorderAssets(assets: readonly AssetDto[], sourceId: string, targetId: string, placeAfterTarget: boolean) {
  const source = assets.find((asset) => asset.id === sourceId);
  if (!source || sourceId === targetId) return [...assets];
  const next = assets.filter((asset) => asset.id !== sourceId);
  const targetIndex = next.findIndex((asset) => asset.id === targetId);
  if (targetIndex < 0) return [...assets];
  next.splice(targetIndex + Number(placeAfterTarget), 0, source);
  return next;
}

function referenceAssetDragSourceId(dataTransfer: DataTransfer, assets: readonly AssetDto[]) {
  const sourceId = readSingleImageAssetDrag(dataTransfer);
  return sourceId && assets.some((asset) => asset.id === sourceId) ? sourceId : null;
}

function paletteLabel(reference: AppliedWordPalette) {
  return resolveLocalizedName(reference.revision, reference.promptLocale);
}

function paletteParameters(reference: AppliedWordPalette) {
  return reference.revision.parameters.flatMap((parameter) => {
    const value = reference.parameterValues[parameter.stableKey];
    const option = parameter.options.find((item) => item.value === value);
    if (!option) return [];
    return [
      {
        id: parameter.id,
        name: resolveWordPaletteParameterName(parameter, reference.promptLocale),
        value: resolveWordPaletteOptionLabel(option, reference.promptLocale),
      },
    ];
  });
}

function RecipeSourceDetails({ reference, onOpenPalette }: { reference: AppliedWordPalette; onOpenPalette(): void }) {
  const parameters = paletteParameters(reference);
  return (
    <div className="grid max-h-80 gap-3 overflow-y-auto" data-recipe-source-details={reference.palette.id}>
      <header className="flex items-baseline justify-between gap-3">
        <Button
          data-action="open-word-palette-reference"
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 justify-start p-0 font-semibold shadow-none hover:bg-transparent"
          onClick={onOpenPalette}
        >
          {paletteLabel(reference)}
        </Button>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          V{reference.revision.revisionNo} · {reference.promptLocale.toUpperCase()}
        </span>
      </header>
      {parameters.length > 0 && (
        <div className="grid gap-1.5">
          {parameters.map((parameter) => (
            <div className="flex items-baseline justify-between gap-4 text-xs" key={parameter.id}>
              <span className="text-muted-foreground">{parameter.name}</span>
              <span className="text-right">{parameter.value}</span>
            </div>
          ))}
        </div>
      )}
      {reference.revision.terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reference.revision.terms.map((term) => (
            <span className="rounded-full bg-muted px-2 py-1 text-xs" key={term.id}>
              {term.title}
            </span>
          ))}
        </div>
      )}
      <footer className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <DictionaryIcon className="size-3" />
          {reference.revision.terms.length}
        </span>
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3" />
          {reference.revision.referenceAssets.length}
        </span>
      </footer>
    </div>
  );
}

function RecipeSourceControl({
  useId,
  reference,
  removeLabel,
  onOpenPalette,
  onRemovePalette,
}: {
  useId: string;
  reference: AppliedWordPalette;
  removeLabel: string;
  onOpenPalette(id: string): void;
  onRemovePalette(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function show() {
    cancelClose();
    setOpen(true);
  }

  function closeSoon() {
    cancelClose();
    if (pinned.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  }

  function togglePinned() {
    pinned.current = !pinned.current;
    cancelClose();
    setOpen(pinned.current);
  }

  useEffect(() => () => cancelClose(), []);

  return (
    <span
      data-palette-id={reference.palette.id}
      data-recipe-use-id={useId}
      className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-full border bg-background"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) pinned.current = false;
          setOpen(next);
        }}
      >
        <PopoverAnchor asChild>
          <Button
            data-action="expand-word-palette-reference"
            type="button"
            variant="ghost"
            size="sm"
            className="h-full min-w-0 rounded-none border-0 px-2.5 font-normal shadow-none"
            aria-expanded={open}
            onPointerEnter={show}
            onPointerLeave={closeSoon}
            onFocus={show}
            onBlur={closeSoon}
            onClick={togglePinned}
          >
            <DictionaryIcon className="size-3.5 shrink-0" />
            <span className="truncate">{paletteLabel(reference)}</span>
          </Button>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-96 max-w-[calc(100vw-2rem)]"
          onPointerEnter={show}
          onPointerLeave={closeSoon}
          onFocusCapture={show}
          onBlurCapture={closeSoon}
        >
          <RecipeSourceDetails reference={reference} onOpenPalette={() => onOpenPalette(reference.palette.id)} />
        </PopoverContent>
      </Popover>
      <Button
        data-action="remove-word-palette-reference"
        data-remove-source="recipe"
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-full shadow-none"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemovePalette(reference.palette.id)}
      >
        <CloseIcon className="size-3" />
      </Button>
    </span>
  );
}

export function CreationReferenceStrip({
  assets,
  imageImporting = false,
  promptResolution,
  removeLabel,
  onAssetsChange,
  onRemoveAsset,
  onRemovePalette,
  onRemoveTerm,
  onOpenPalette,
  onOpenTerm,
  notify,
  revealContext,
  hidePromptMaterials = false,
}: Props) {
  const { locale, messages } = useI18n();
  const fileLabels = messages.assetFile;
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [copyingAssetId, setCopyingAssetId] = useState<string | null>(null);
  const [dragTargetAssetId, setDragTargetAssetId] = useState<string | null>(null);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const directTerms = hidePromptMaterials
    ? []
    : promptResolution.effectiveTerms.filter(({ directSource }) => directSource);
  const recipeSources = hidePromptMaterials ? [] : promptResolution.recipeSources;

  useEffect(() => {
    if (previewAssetId && !assetsById.has(previewAssetId)) setPreviewAssetId(null);
  }, [assetsById, previewAssetId]);

  async function copyImage(assetId: string) {
    if (copyingAssetId) return;
    setCopyingAssetId(assetId);
    notify(fileLabels.copying);
    try {
      await window.desktopApi.assetFileCopy(assetId);
      notify(fileLabels.copied);
    } catch (reason) {
      notify(`${fileLabels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCopyingAssetId(null);
    }
  }

  function removeAsset(assetId: string) {
    const index = assets.findIndex((asset) => asset.id === assetId);
    const nextPreviewId = assets[index + 1]?.id ?? assets[index - 1]?.id ?? null;
    onRemoveAsset(assetId);
    if (previewAssetId === assetId) setPreviewAssetId(nextPreviewId);
  }

  if (!assets.length && !imageImporting && !recipeSources.length && !directTerms.length) return null;

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
        {imageImporting ? (
          <span
            role="status"
            aria-label={locale === 'zh' ? '正在导入图片' : 'Importing image'}
            data-reference-image-importing=""
            className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground"
          >
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          </span>
        ) : null}
        {assets.map((asset, index) => (
          <span
            className={cn(
              'group relative isolate size-12 rounded-md bg-surface-sunken',
              dragTargetAssetId === asset.id && 'ring-2 ring-selected-border',
            )}
            key={asset.id}
            onDragOver={(event) => {
              if (!referenceAssetDragSourceId(event.dataTransfer, assets)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              setDragTargetAssetId(asset.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTargetAssetId(null);
            }}
            onDrop={(event) => {
              const sourceId = referenceAssetDragSourceId(event.dataTransfer, assets);
              if (!sourceId) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              setDragTargetAssetId(null);
              onAssetsChange(
                reorderAssets(assets, sourceId, asset.id, event.clientX >= bounds.left + bounds.width / 2),
              );
            }}
          >
            <AssetFileContextMenu assetId={asset.id} notify={notify} revealContext={revealContext}>
              <Button
                type="button"
                variant="ghost"
                draggable
                className="relative isolate size-12 cursor-grab overflow-hidden rounded-md p-0 shadow-none hover:bg-transparent active:cursor-grabbing focus-visible:ring-inset focus-visible:ring-offset-0"
                title={locale === 'zh' ? '拖动调整顺序或导出，单击放大' : 'Drag to reorder or export, click to enlarge'}
                aria-label={
                  locale === 'zh'
                    ? `第 ${index + 1} 张图片：拖动调整顺序或导出，单击放大`
                    : `Image ${index + 1}: drag to reorder or export, click to enlarge`
                }
                onDragEnd={() => setDragTargetAssetId(null)}
                onKeyDown={(event) => {
                  const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                  const target = assets[index + offset];
                  if (!offset || !target) return;
                  event.preventDefault();
                  onAssetsChange(reorderAssets(assets, asset.id, target.id, offset > 0));
                }}
                onClick={() => setPreviewAssetId(asset.id)}
              >
                <ImageAmbientBackdrop src={asset.mediaUrl} />
                <img
                  className="relative z-10 size-full rounded-md object-contain"
                  src={asset.mediaUrl}
                  alt=""
                  draggable={false}
                />
              </Button>
            </AssetFileContextMenu>
            <Button
              className="absolute -top-1.5 -right-1.5 z-20 size-6 rounded-full bg-overlay text-foreground opacity-0 shadow-overlay group-focus-within:opacity-100 group-hover:opacity-100"
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={removeLabel}
              onClick={() => removeAsset(asset.id)}
            >
              <CloseIcon className="size-3" />
            </Button>
          </span>
        ))}
        <TooltipProvider delayDuration={280}>
          {directTerms.map(({ term, resolved, recipeUseIds }) => (
            <TermPreviewTooltip term={term} key={term.id}>
              <span
                data-effective-term-id={term.id}
                data-direct-source="true"
                data-recipe-source-count={recipeUseIds.length}
                className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-full bg-secondary text-secondary-foreground"
              >
                <Button
                  data-action="open-term-reference"
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-full min-w-0 rounded-none border-0 px-3 font-normal shadow-none"
                  onClick={() => onOpenTerm(term)}
                >
                  <span className="truncate">{term.title}</span>
                  {resolved.sourcePaths.length > 1 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">×{resolved.sourcePaths.length}</span>
                  )}
                </Button>
                <Button
                  data-action="remove-term-reference"
                  data-remove-source="direct"
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 shrink-0 rounded-full shadow-none"
                  aria-label={removeLabel}
                  title={removeLabel}
                  onClick={() => onRemoveTerm(term)}
                >
                  <CloseIcon className="size-3" />
                </Button>
              </span>
            </TermPreviewTooltip>
          ))}
        </TooltipProvider>
        {recipeSources.map(({ useId, reference }) => (
          <RecipeSourceControl
            key={useId}
            useId={useId}
            reference={reference}
            removeLabel={removeLabel}
            onOpenPalette={onOpenPalette}
            onRemovePalette={onRemovePalette}
          />
        ))}
      </div>
      <MediaPreviewDialog
        assetIds={assets.map((asset) => asset.id)}
        assetsById={assetsById}
        copyingAssetId={copyingAssetId}
        copyLabel={fileLabels.copy}
        dataDialog="creation-input-media-preview"
        locale={locale}
        openAssetId={previewAssetId}
        notify={notify}
        onCopy={(assetId) => void copyImage(assetId)}
        onOpenAssetIdChange={setPreviewAssetId}
        onRemove={removeAsset}
      />
    </>
  );
}
