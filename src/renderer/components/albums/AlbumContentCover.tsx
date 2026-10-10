import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ALBUM_COVER_LAYERS } from '@/renderer/components/albums/albumCoverAssets';
import { EmptyAlbumIcon } from '@/renderer/components/albums/EmptyAlbumIcon';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface AlbumContentPreview {
  id: string;
  title: string;
  icon: LucideIcon;
  onOpen(): void;
}

const expandedStep = 32;

/** Each layer represents one real member; no samples leaves a single album cover. */
export function AlbumContentCover({
  previews = [],
  expanded = false,
  animate = true,
  className,
}: {
  previews?: readonly AlbumContentPreview[];
  expanded?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const layers = previews.slice(0, ALBUM_COVER_LAYERS);
  return (
    <span
      aria-hidden="true"
      data-slot="album-content-cover"
      data-content-count={layers.length}
      className={cn('relative block size-7', className)}
    >
      {layers.length ? (
        layers.map(({ id, icon: Icon }, index) => (
          <span
            key={id}
            className={cn(
              'absolute left-0.5 top-0.5 grid h-6 w-5 place-items-center rounded-sm border border-current bg-surface text-muted-foreground',
              animate && 'transition-transform duration-150 motion-reduce:transition-none',
            )}
            style={{
              transform: `translateX(${index * (expanded ? expandedStep : 3)}px)`,
              zIndex: layers.length - index,
            }}
          >
            <Icon className="size-3.5" />
          </span>
        ))
      ) : (
        <EmptyAlbumIcon className="size-7 text-muted-foreground" />
      )}
    </span>
  );
}

/** The cover itself reveals members; opening the album remains on its title. */
export function AlbumContentCoverPreview({
  previews,
  title,
  animate = true,
}: {
  previews: readonly AlbumContentPreview[];
  title: string;
  animate?: boolean;
}) {
  const labels = useI18n().messages.gallery.albums;
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  const contentId = useId();
  const layers = previews.slice(0, ALBUM_COVER_LAYERS);
  const expandedWidth = Math.max(28, (layers.length - 1) * expandedStep + 28);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [expanded]);

  return (
    <span
      ref={rootRef}
      className={cn('relative block h-7', animate && 'transition-[width] duration-150 motion-reduce:transition-none')}
      style={{ width: expanded ? expandedWidth : 28 }}
      data-content-expanded={expanded}
      data-item-drag-ignore
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setExpanded(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch' && !event.currentTarget.querySelector(':focus-visible')) setExpanded(false);
      }}
      onPointerCancel={() => setExpanded(false)}
      onFocusCapture={(event) => {
        if (restoringFocus.current) restoringFocus.current = false;
        else if (event.target.matches(':focus-visible')) setExpanded(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return;
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        if (document.activeElement !== triggerRef.current) {
          restoringFocus.current = true;
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        className="absolute inset-0 size-7 rounded-sm p-0 hover:bg-transparent"
        aria-label={labels.previewTitle(title)}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(true)}
      />
      <AlbumContentCover previews={layers} expanded={expanded} animate={animate} className="pointer-events-none" />
      <span
        id={contentId}
        role="group"
        aria-label={labels.previewTitle(title)}
        hidden={!expanded}
        className="absolute left-0 top-0 h-7"
        style={{ width: expandedWidth }}
      >
        {layers.map(({ id, title: contentTitle, onOpen }, index) => (
          <Button
            key={id}
            type="button"
            variant="ghost"
            title={contentTitle}
            aria-label={contentTitle}
            tabIndex={expanded ? 0 : -1}
            className="absolute -top-0.5 size-8 rounded-sm p-0 hover:bg-transparent hover:ring-1 hover:ring-border focus-visible:ring-offset-0"
            style={{ left: index * expandedStep }}
            onClick={() => {
              setExpanded(false);
              onOpen();
            }}
          />
        ))}
      </span>
    </span>
  );
}
