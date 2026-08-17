import type { GalleryItemDto, Locale } from '@/shared/contracts';
import { materialTitle, mediaMaterial } from '@/renderer/components/gallery/materialLibraryTypes';
import { AssetMedia } from '@/renderer/components/media/AssetMedia';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  locale: Locale;
  items: readonly GalleryItemDto[];
  loading: boolean;
  selectedMaterialId: string | null;
  onSelect(item: GalleryItemDto): void;
}

export function VideoDocumentRecentVideos({ locale, items, loading, selectedMaterialId, onSelect }: Props) {
  const labels = useI18n().messages.videoDocuments.start;
  if (!loading && !items.length) return null;
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{labels.recentVideos}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="grid gap-2">
                <Skeleton className="aspect-video rounded-lg" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          : items.slice(0, 4).map((item) => {
              const title = materialTitle(mediaMaterial(item), labels.sourceVideoFallback);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'min-w-0 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                    selectedMaterialId === item.materialId && 'bg-selected ring-1 ring-selected-border',
                  )}
                  title={title}
                  onClick={() => onSelect(item)}
                >
                  <AssetMedia
                    asset={item.asset}
                    className="aspect-video w-full rounded-md bg-media-surround-dark object-cover"
                    loading="lazy"
                    muted
                  />
                  <strong className="mt-2 block truncate text-xs font-medium">{title}</strong>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {dateFormatter.format(new Date(item.createdAt))}
                  </span>
                </button>
              );
            })}
      </div>
    </section>
  );
}
