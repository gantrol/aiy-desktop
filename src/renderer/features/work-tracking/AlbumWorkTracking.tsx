import type { ArticleDto, BootstrapDto } from '@/shared/contracts';
import { WORK_TRACKING_EXTENSION_ID } from '@/shared/extension-ids';
import { WorkTrackingScreen } from '@/renderer/features/work-tracking/WorkTrackingScreen';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AlbumWorkTracking({
  albumId,
  data,
  archived,
  notify,
  onArticleSaved,
}: {
  albumId: string;
  data: BootstrapDto;
  archived: boolean;
  notify(message: string): void;
  onArticleSaved(article: ArticleDto): void;
}) {
  const l = useI18n().messages.workTracking;
  const extension = data.extensions?.find((entry) => entry.manifest.id === WORK_TRACKING_EXTENSION_ID);
  if (archived || !extension)
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        {archived ? l.albumUnavailable : l.errors.disabled}
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <WorkTrackingScreen
        key={`${data.spaceId}:${albumId}`}
        albumId={albumId}
        active
        data={data}
        extension={extension}
        notify={notify}
        onArticleSaved={onArticleSaved}
      />
    </div>
  );
}
