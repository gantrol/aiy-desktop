import { useMemo, useState } from 'react';
import type { PromptVersionDto } from '@/shared/contracts';
import type { CreationResultDraftRow } from '@/renderer/components/creator/creationResultsOrganizer';
import { comparisonPromptForVersion, diffPromptText } from '@/renderer/components/creator/generationComparisonUtils';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  row: CreationResultDraftRow;
  belowRow?: CreationResultDraftRow;
  versions: readonly PromptVersionDto[];
}

function promptForRow(row: CreationResultDraftRow, versions: readonly PromptVersionDto[]) {
  const recorded = row.output.generationText.trim();
  if (recorded) return recorded;
  const version = row.promptVersionId ? versions.find((candidate) => candidate.id === row.promptVersionId) : undefined;
  return version
    ? comparisonPromptForVersion(version, row.output.executionRouteKey ?? row.output.modelKey ?? null)
    : '';
}

export function CreationResultPreviewHoverCard({ row, belowRow, versions }: Props) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const [open, setOpen] = useState(false);
  const prompt = open ? promptForRow(row, versions) : '';
  const belowPrompt = open && belowRow ? promptForRow(belowRow, versions) : '';
  const diff = useMemo(
    () => (open && belowRow ? diffPromptText(belowPrompt, prompt) : []),
    [belowPrompt, belowRow, open, prompt],
  );
  const promptChanged = diff.some((part) => part.type !== 'equal');

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="relative isolate size-11 overflow-hidden rounded-md border bg-surface-sunken p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={labels.previewOutput(row.displayName)}
        >
          <AssetThumbnail
            asset={row.output.asset}
            size={96}
            ambient
            alt=""
            className="relative z-10 size-full rounded-sm object-contain"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(40rem,calc(100vw-3rem))] max-w-none overflow-hidden p-0"
      >
        <div className="grid h-[min(58vh,30rem)] grid-cols-2">
          <div className="relative isolate min-h-0 overflow-hidden bg-surface-sunken p-3">
            <ImageAmbientBackdrop src={row.output.asset.mediaUrl} />
            <img
              src={row.output.asset.mediaUrl}
              alt={row.displayName}
              className="relative z-10 size-full object-contain"
              decoding="async"
              draggable={false}
            />
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain border-l p-4">
            <h3 className="text-sm font-semibold">{row.displayName}</h3>
            <section className="mt-4">
              <h4 className="text-xs font-medium text-muted-foreground">{labels.prompt}</h4>
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {prompt || <span className="font-sans text-muted-foreground">{labels.promptEmpty}</span>}
              </div>
            </section>
            {belowRow && (
              <section className="mt-5 border-t pt-4">
                <h4 className="text-xs font-medium text-muted-foreground">
                  {labels.promptDiffWithBelow(belowRow.displayName)}
                </h4>
                <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {!prompt && !belowPrompt ? (
                    <span className="font-sans text-muted-foreground">{labels.promptEmpty}</span>
                  ) : !promptChanged ? (
                    <span className="font-sans text-muted-foreground">{labels.promptUnchanged}</span>
                  ) : (
                    diff.map((part, index) =>
                      part.type === 'equal' ? (
                        <span key={index} className="text-muted-foreground">
                          {part.value}
                        </span>
                      ) : (
                        <span
                          key={index}
                          className={
                            part.type === 'added'
                              ? 'rounded-sm bg-state-changed-bg text-state-changed-fg'
                              : 'rounded-sm bg-destructive/10 text-destructive line-through decoration-destructive/60'
                          }
                        >
                          <span className="sr-only">
                            {part.type === 'added' ? `${labels.diffAdded}: ` : `${labels.diffRemoved}: `}
                          </span>
                          {part.value}
                        </span>
                      ),
                    )
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
