import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { FileTextIcon, ImageIcon, PanelRightCloseIcon } from 'lucide-react';
import type { AssetDto, AssetFileRevealContext, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { CreatorReferenceImageCard } from '@/renderer/components/creator/CreatorReferenceImageCard';
import { MediaPreviewDialog } from '@/renderer/components/media/MediaPreviewDialog';

interface Props {
  headerNavigation: ReactNode;
  locale: Locale;
  prompt: string;
  referenceAssets: AssetDto[];
  collapsed: boolean;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
  revealContext?: AssetFileRevealContext;
  notify(message: string): void;
  onReferenceAssetsChange(assets: AssetDto[]): void;
  onCollapsedChange(collapsed: boolean): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeValueChange(value: number): void;
}

export function CreatorInputPanel({
  headerNavigation,
  locale,
  prompt,
  referenceAssets,
  collapsed,
  resizeValue,
  resizeMin,
  resizeMax,
  revealContext,
  notify,
  onReferenceAssetsChange,
  onCollapsedChange,
  onResizeStart,
  onResizeValueChange,
}: Props) {
  const { messages } = useI18n();
  const textLabel = locale === 'zh' ? '文字' : 'Text';
  const imageLabel = locale === 'zh' ? '图片' : 'Images';
  const resizeLabel = locale === 'zh' ? '调整输入区宽度' : 'Resize inputs';
  const fileLabels = messages.assetFile;
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [copyingAssetId, setCopyingAssetId] = useState<string | null>(null);
  const assetsById = useMemo(() => new Map(referenceAssets.map((asset) => [asset.id, asset])), [referenceAssets]);

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

  function removeImage(assetId: string) {
    const index = referenceAssets.findIndex((asset) => asset.id === assetId);
    const nextPreviewId = referenceAssets[index + 1]?.id ?? referenceAssets[index - 1]?.id ?? null;
    onReferenceAssetsChange(referenceAssets.filter((asset) => asset.id !== assetId));
    if (previewAssetId === assetId) setPreviewAssetId(nextPreviewId);
  }

  if (collapsed) {
    return (
      <section className="relative hidden size-full min-h-0 flex-col items-center bg-secondary pt-3 @min-[840px]/creator:flex">
        <CreatorPaneResizeHandle
          edge="left"
          label={resizeLabel}
          value={resizeValue}
          min={resizeMin}
          max={resizeMax}
          onValueChange={onResizeValueChange}
          onPointerDown={onResizeStart}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={locale === 'zh' ? '展开输入' : 'Expand inputs'}
          aria-label={locale === 'zh' ? '展开输入' : 'Expand inputs'}
          onClick={() => onCollapsedChange(false)}
        >
          <FileTextIcon className="size-4" />
        </Button>
      </section>
    );
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-background">
      <CreatorPaneResizeHandle
        edge="left"
        label={resizeLabel}
        value={resizeValue}
        min={resizeMin}
        max={resizeMax}
        onValueChange={onResizeValueChange}
        onPointerDown={onResizeStart}
      />
      <header className="flex h-14 shrink-0 items-center border-b border-border/60 bg-secondary px-3">
        {headerNavigation}
      </header>
      <ScrollArea type="always" className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5">
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <span>{textLabel}</span>
            </div>
            <div className="min-h-24 whitespace-pre-wrap rounded-md border bg-surface px-3 py-2.5 text-sm leading-6">
              {prompt || '—'}
            </div>
          </section>
          {referenceAssets.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ImageIcon className="size-4 text-muted-foreground" />
                <span>
                  {imageLabel} · {referenceAssets.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {referenceAssets.map((asset, index) => (
                  <CreatorReferenceImageCard
                    key={asset.id}
                    asset={asset}
                    referenceAssets={referenceAssets}
                    copyingAssetId={copyingAssetId}
                    copyLabel={fileLabels.copy}
                    dragTargetId={dragTargetId}
                    index={index}
                    locale={locale}
                    moreActionsLabel={messages.creator.album.moreActions}
                    revealContext={revealContext}
                    notify={notify}
                    onCopy={(assetId) => void copyImage(assetId)}
                    onDragTargetIdChange={setDragTargetId}
                    onPreview={setPreviewAssetId}
                    onReferenceAssetsChange={onReferenceAssetsChange}
                    onRemove={removeImage}
                  />
                ))}
              </div>
              <MediaPreviewDialog
                assetIds={referenceAssets.map((asset) => asset.id)}
                assetsById={assetsById}
                copyingAssetId={copyingAssetId}
                copyLabel={fileLabels.copy}
                dataDialog="creator-reference-media-preview"
                locale={locale}
                openAssetId={previewAssetId}
                notify={notify}
                onCopy={(assetId) => void copyImage(assetId)}
                onOpenAssetIdChange={setPreviewAssetId}
                onRemove={removeImage}
              />
            </section>
          )}
        </div>
      </ScrollArea>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-2 left-2 z-30 hidden shadow-overlay @min-[840px]/creator:inline-flex"
        title={locale === 'zh' ? '收起输入区' : 'Collapse inputs'}
        aria-label={locale === 'zh' ? '收起输入区' : 'Collapse inputs'}
        onClick={() => onCollapsedChange(true)}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </section>
  );
}
