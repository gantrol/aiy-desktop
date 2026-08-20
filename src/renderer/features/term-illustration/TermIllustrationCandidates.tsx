import { ExternalLinkIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { useTermIllustration } from '@/renderer/features/term-illustration/TermIllustrationProvider';
import { qualityLabel, runStatusLabel } from '@/renderer/features/term-illustration/termIllustrationPresentation';

export function TermIllustrationCandidates() {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail.illustration;
  const { term, routes, candidates, actionBusy, notify, adopt, dismiss, openCreation } = useTermIllustration();

  if (!candidates.length) {
    return <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">{copy.emptyCandidates}</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {candidates.map(({ batch, run }) => {
        const routeName = routes.find((route) => route.key === run.modelKey)?.name ?? run.modelKey;
        return (
          <article key={run.id} className="overflow-hidden rounded-xl border bg-background">
            {run.asset && (
              <AssetFileContextMenu
                assetId={run.asset.id}
                revealContext={{ kind: 'TERM', termId: term.id }}
                notify={notify}
              >
                <div className="relative isolate grid aspect-[4/3] place-items-center overflow-hidden bg-surface-sunken">
                  <ImageAmbientBackdrop src={run.asset.mediaUrl} loading="lazy" />
                  <img
                    className="relative z-10 size-full object-contain"
                    src={run.asset.mediaUrl}
                    alt={copy.candidateAlt}
                    draggable={false}
                    loading="lazy"
                    width={run.asset.width}
                    height={run.asset.height}
                  />
                </div>
              </AssetFileContextMenu>
            )}
            <div className="grid gap-3 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{runStatusLabel(run.status, copy)}</Badge>
                <span>{routeName}</span>
                <span>·</span>
                <span>{qualityLabel(run.quality, copy)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" disabled={actionBusy} onClick={() => void adopt(run.id, 'COVER')}>
                  {copy.setCover}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={actionBusy}
                  onClick={() => void adopt(run.id, 'RELATED')}
                >
                  {copy.addRelated}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!batch.seriesId}
                  onClick={() => openCreation(batch, run)}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  {copy.openCreation}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionBusy}
                  onClick={() => void dismiss(run.id)}
                >
                  {copy.dismiss}
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
