import { CircleCheckIcon, Clock3Icon, ExternalLinkIcon, LoaderCircleIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { AmbientImage } from '@/renderer/components/media/AmbientImage';
import { useTermIllustration } from '@/renderer/features/term-illustration/TermIllustrationProvider';
import {
  batchStatusLabel,
  decisionLabel,
  runStatusLabel,
} from '@/renderer/features/term-illustration/termIllustrationPresentation';

export function TermIllustrationHistory() {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail.illustration;
  const { term, locale, history, openCreation } = useTermIllustration();
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  if (!history.batches.length) {
    return <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">{copy.emptyHistory}</div>;
  }

  return (
    <div className="grid gap-3">
      {history.batches.map((batch) => (
        <article key={batch.id} className="rounded-xl border bg-background p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{batchStatusLabel(batch, copy)}</Badge>
                <span className="text-xs font-medium">{batch.modelKey}</span>
                <span className="text-xs text-muted-foreground">{formatDate(batch.createdAt)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {copy.revision} {batch.termRevisionId.slice(-6)} · {copy.promptProfile} {batch.promptProfileId} ·{' '}
                {batch.profileId}@{batch.profileRevision}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!batch.seriesId}
              onClick={() => openCreation(batch)}
            >
              <ExternalLinkIcon className="size-3.5" />
              {copy.openCreation}
            </Button>
          </div>
          {batch.errorMessage && <p className="mt-3 text-xs text-destructive">{batch.errorMessage}</p>}
          {batch.runs.length > 0 && (
            <div className="mt-3 grid gap-2 border-t pt-3">
              {batch.runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3">
                  {run.asset ? (
                    <AmbientImage
                      frameClassName="size-12 shrink-0 rounded-md border"
                      className="size-full object-contain"
                      src={run.asset.mediaUrl}
                      alt={copy.candidateAlt}
                      draggable={false}
                      loading="lazy"
                      width={run.asset.width}
                      height={run.asset.height}
                    />
                  ) : (
                    <div className="grid size-12 shrink-0 place-items-center rounded-md border bg-surface-sunken">
                      {run.status === 'QUEUED' || run.status === 'RUNNING' ? (
                        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                      ) : run.status === 'SUCCEEDED' ? (
                        <CircleCheckIcon className="size-4 text-success" />
                      ) : (
                        <Clock3Icon className="size-4 text-muted-foreground" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span>{runStatusLabel(run.status, copy)}</span>
                      <Badge variant="outline">
                        {run.decision === 'PENDING' && batch.termRevisionId !== term.termRevisionId
                          ? copy.outdated
                          : decisionLabel(run.decision, copy)}
                      </Badge>
                    </div>
                    {run.errorMessage && <p className="mt-1 truncate text-xs text-destructive">{run.errorMessage}</p>}
                  </div>
                  {run.asset && batch.seriesId && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => openCreation(batch, run)}>
                      <ExternalLinkIcon className="size-3.5" />
                      <span className="sr-only">{copy.openCreation}</span>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
