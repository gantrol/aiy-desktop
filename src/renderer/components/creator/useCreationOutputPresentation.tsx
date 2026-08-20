import { CheckIcon, ImagesIcon, LoaderCircleIcon, RotateCcwIcon, UnlinkIcon, XIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { MAX_PROMPT_SERIES_COVERS } from '@/shared/contracts/creation-output-presentation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';

interface PresentationAssetRecord {
  asset: { id: string };
  ownerSeries: Pick<PromptSeriesDto, 'id' | 'title'>;
  failed: boolean;
}

interface Input {
  records: readonly PresentationAssetRecord[];
  coverSeries?: Pick<PromptSeriesDto, 'id' | 'explicitCoverAssetId' | 'explicitCoverAssetIds'>;
  refresh(): Promise<void>;
  notify(message: string): void;
}

interface RemovalTarget {
  seriesId: string;
  imageAssetId: string;
  seriesTitle: string;
}

export function useCreationOutputPresentation({ records, coverSeries, refresh, notify }: Input) {
  const { messages } = useI18n();
  const copy = messages.creator.outputPresentation;
  const [busy, setBusy] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);

  const setCovers = useCallback(
    async (seriesId: string, imageAssetIds: readonly string[]) => {
      if (busy) return;
      setBusy(true);
      try {
        await window.desktopApi.promptSeriesCoverSet({ seriesId, imageAssetIds: [...imageAssetIds] });
        await refresh();
        notify(imageAssetIds.length > 0 ? copy.coverSet : copy.automaticCoverSet);
      } catch (reason) {
        notify(`${copy.actionFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, copy, notify, refresh],
  );

  const actionsForAsset = useCallback(
    (imageAssetId: string): readonly ActionMenuAction[] => {
      const record = records.find((candidate) => candidate.asset.id === imageAssetId);
      if (!record || record.failed) return [];
      const coverSeriesId = coverSeries?.id ?? null;
      const explicitCoverAssetIds =
        coverSeries?.explicitCoverAssetIds ??
        (coverSeries?.explicitCoverAssetId ? [coverSeries.explicitCoverAssetId] : []);
      const selectedCoverIndex = explicitCoverAssetIds.indexOf(imageAssetId);
      const coverEligible = Boolean(coverSeriesId);
      const coverActions: ActionMenuAction[] = [];
      if (coverSeriesId) {
        if (selectedCoverIndex >= 0) {
          coverActions.push(
            {
              id: 'current-creation-cover',
              label: copy.coverPosition(selectedCoverIndex + 1),
              icon: CheckIcon,
              disabled: true,
              onSelect: () => undefined,
            },
            {
              id: 'remove-creation-cover',
              label: copy.removeCover,
              icon: XIcon,
              disabled: busy,
              onSelect: () => {
                void setCovers(
                  coverSeriesId,
                  explicitCoverAssetIds.filter((assetId) => assetId !== imageAssetId),
                );
              },
            },
          );
        } else {
          const maximumReached = explicitCoverAssetIds.length >= MAX_PROMPT_SERIES_COVERS;
          coverActions.push({
            id: 'add-creation-cover',
            label: maximumReached ? copy.maximumCovers(MAX_PROMPT_SERIES_COVERS) : copy.addCover,
            icon: ImagesIcon,
            disabled: busy || maximumReached,
            onSelect: () => {
              void setCovers(coverSeriesId, [...explicitCoverAssetIds, imageAssetId]);
            },
          });
        }
        if (explicitCoverAssetIds.length > 0) {
          coverActions.push({
            id: 'use-automatic-creation-cover',
            label: copy.useAutomaticCover,
            icon: RotateCcwIcon,
            disabled: busy,
            separatorBefore: true,
            onSelect: () => void setCovers(coverSeriesId, []),
          });
        }
      }
      return [
        ...coverActions,
        {
          id: 'remove-output-from-creation',
          label: copy.remove,
          icon: UnlinkIcon,
          destructive: true,
          disabled: busy,
          separatorBefore: coverEligible,
          onSelect: () =>
            setRemovalTarget({
              seriesId: record.ownerSeries.id,
              imageAssetId,
              seriesTitle: record.ownerSeries.title,
            }),
        },
      ];
    },
    [busy, copy, coverSeries, records, setCovers],
  );

  async function remove() {
    if (!removalTarget || busy) return;
    setBusy(true);
    try {
      await window.desktopApi.promptSeriesOutputRemove({
        seriesId: removalTarget.seriesId,
        imageAssetId: removalTarget.imageAssetId,
      });
      setRemovalTarget(null);
      await refresh();
      notify(copy.removed);
    } catch (reason) {
      notify(`${copy.actionFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog
      open={Boolean(removalTarget)}
      onOpenChange={(open) => {
        if (!open && !busy) setRemovalTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.removeTitle}</DialogTitle>
          <DialogDescription>
            {removalTarget?.seriesTitle} — {copy.removeDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setRemovalTarget(null)}>
            {messages.common.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {copy.confirmRemove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { actionsForAsset, dialog };
}
