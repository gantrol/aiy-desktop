import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { FileTextIcon, ImageIcon, PanelRightCloseIcon } from 'lucide-react';
import type { AssetDto, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';

interface Props {
  headerNavigation: ReactNode;
  locale: Locale;
  prompt: string;
  referenceAssets: AssetDto[];
  collapsed: boolean;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
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
  onCollapsedChange,
  onResizeStart,
  onResizeValueChange,
}: Props) {
  const textLabel = locale === 'zh' ? '文字' : 'Text';
  const imageLabel = locale === 'zh' ? '图片' : 'Images';
  const resizeLabel = locale === 'zh' ? '调整输入区宽度' : 'Resize inputs';

  if (collapsed) {
    return (
      <section className="relative hidden size-full min-h-0 flex-col items-center bg-secondary pt-3 min-[840px]:flex">
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {referenceAssets.map((asset) => (
                  <div key={asset.id} className="overflow-hidden rounded-md border bg-surface-sunken">
                    <img
                      src={mediaThumbnailUrl(asset, 320)}
                      alt=""
                      width={asset.width}
                      height={asset.height}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="aspect-square w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-2 left-2 z-30 hidden shadow-overlay min-[840px]:inline-flex"
        title={locale === 'zh' ? '收起输入区' : 'Collapse inputs'}
        aria-label={locale === 'zh' ? '收起输入区' : 'Collapse inputs'}
        onClick={() => onCollapsedChange(true)}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </section>
  );
}
