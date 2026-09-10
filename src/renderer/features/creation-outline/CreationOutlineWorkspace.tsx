import { useMemo } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import type { CreationOutlineCommand } from '@/shared/contracts/creation-outline';
import type { CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';
import { buildCreationLibraryProjection } from '@/renderer/components/creator/creationLibraryProjection';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { creationFormTabTarget } from '@/renderer/components/creator/creationFormTabTarget';
import { CreationOutline } from '@/renderer/features/creation-outline/CreationOutline';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Props {
  data: BootstrapDto;
  visible: boolean;
  albumId: string | null;
  documentNavigationRevision: number;
  refresh(): Promise<void>;
  notify(message: string): void;
  onOpenBeside(target: CreatorOpenTabTarget): void;
}

export function CreationOutlineWorkspace({
  data,
  visible,
  albumId,
  documentNavigationRevision,
  refresh,
  notify,
  onOpenBeside,
}: Props) {
  const { locale, messages } = useI18n();
  const projection = useMemo(
    () =>
      buildCreationLibraryProjection({
        creationItems: data.creationItems,
        animations: data.animations,
        labels: messages.creator.album,
        locale,
        series: data.series,
        imageBreakdowns: data.imageBreakdowns ?? [],
        evaluationSuites: data.evaluationSuites ?? [],
        sessions: buildCreationSessionProjection(data.series, data.styleExplorationBatches),
        inspirationStashes: data.inspirationStashes ?? [],
        socialPosts: data.socialPosts ?? [],
        articles: data.articles ?? [],
        videoDocuments: [],
        derivedVisuals: data.derivedVisuals ?? [],
      }),
    [data, locale, messages.creator.album],
  );
  const command = useStableCallback(async (input: CreationOutlineCommand) => {
    const result = await window.desktopApi.creationOutlineCommand(input);
    if (result.kind !== 'error') await refresh().catch(() => notify(messages.creator.outline.refreshFailed));
    return result;
  });
  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CreationOutline
        key={albumId ?? 'root'}
        albums={data.albums}
        creations={projection.items}
        initialAlbumId={albumId}
        active={visible}
        busy={false}
        onCommand={command}
        documentNavigationRevision={documentNavigationRevision}
        onOpenAlbum={(id) => onOpenBeside({ view: 'creator', location: { surface: 'album-detail', albumId: id } })}
        onOpenSeries={(id) =>
          onOpenBeside({ view: 'creator', location: { surface: 'existing-creation', seriesId: id, assetId: null } })
        }
        onOpenCreationForm={(form) => {
          const owner = projection.itemById.get(form.form.creationItemId)?.item.albumId ?? null;
          const target = creationFormTabTarget(form, owner);
          if (target) {
            onOpenBeside(target);
            return;
          }
          // Auxiliary visual work can still be a draft; retain its existing workspace identity.
          const visual = data.derivedVisuals?.find((item) => item.id === form.entityRef.id);
          if (visual?.promptSeriesId)
            onOpenBeside({
              view: 'creator',
              location: {
                surface: 'existing-creation',
                seriesId: visual.promptSeriesId,
                derivedVisualId: visual.id,
                assetId: null,
              },
            });
          else if (visual?.creationDraftId)
            onOpenBeside({
              view: 'creator',
              location: {
                surface: 'creation-draft',
                draftId: visual.creationDraftId,
                derivedVisualId: visual.id,
              },
            });
          else notify(messages.creator.outline.errors.UNAVAILABLE);
        }}
      />
    </div>
  );
}
