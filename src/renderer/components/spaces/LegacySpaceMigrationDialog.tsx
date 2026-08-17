import { useEffect, useMemo, useState } from 'react';
import { CheckIcon, DatabaseBackupIcon, HardDriveIcon, LoaderCircleIcon } from 'lucide-react';
import type { LegacyLocalSpaceCandidateDto, LocalSpaceMigrationProgressEvent } from '@/shared/contracts/local-space';
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
import { cn } from '@/renderer/lib/utils';
import { formatDateTime } from '@/renderer/lib/dateFormat';

const candidateDateOptions: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

interface Props {
  open: boolean;
  candidates: LegacyLocalSpaceCandidateDto[];
  onOpenChange(open: boolean): void;
  onSwitched(): void;
  notify(message: string): void;
}

export function LegacySpaceMigrationDialog({ open, candidates, onOpenChange, onSwitched, notify }: Props) {
  const { locale, messages } = useI18n();
  const copy = messages.space.migration;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<LocalSpaceMigrationProgressEvent | null>(null);
  const selected = useMemo(
    () => candidates.find((candidate) => candidate.candidateId === selectedId) ?? candidates[0] ?? null,
    [candidates, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    if (!selectedId || !candidates.some((candidate) => candidate.candidateId === selectedId)) {
      setSelectedId(candidates[0]?.candidateId ?? null);
    }
  }, [candidates, open, selectedId]);

  useEffect(() => {
    if (!open) return;
    return window.desktopApi.onLocalSpaceMigrationProgress((event) => {
      if (!selected || event.candidateId !== selected.candidateId) return;
      setProgress(event);
    });
  }, [open, selected]);

  async function migrate() {
    if (!selected || pending) return;
    setPending(true);
    setProgress(null);
    try {
      const result = await window.desktopApi.localSpacesMigrateLegacy(selected.candidateId);
      if (result.status === 'failed') notify(copy.errors[result.errorCode]);
      if (result.status === 'switched') {
        setPending(false);
        onSwitched();
      } else {
        setPending(false);
        setCancelling(false);
        setProgress(null);
      }
    } catch {
      notify(copy.errors.COPY_FAILED);
      setPending(false);
      setCancelling(false);
      setProgress(null);
    }
  }

  async function cancel() {
    if (!pending) {
      onOpenChange(false);
      return;
    }
    if (cancelling) return;
    setCancelling(true);
    await window.desktopApi.localSpacesCancelLegacyMigration().catch(() => undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {selected?.requiresCopy === false ? copy.openDescription : copy.description}
          </DialogDescription>
        </DialogHeader>

        {pending && progress ? (
          <div className="space-y-3 py-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {copy.stages[progress.stage]}
            </div>
            <div
              role="progressbar"
              aria-label={copy.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.progress}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-base"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <p className="text-right text-xs tabular-nums text-muted-foreground">{progress.progress}%</p>
          </div>
        ) : candidates.length ? (
          <div className="grid max-h-72 gap-2 overflow-y-auto py-2">
            {candidates.map((candidate) => {
              const active = candidate.candidateId === selected?.candidateId;
              return (
                <button
                  key={candidate.candidateId}
                  type="button"
                  data-action="select-legacy-space"
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                    active && 'border-selected-foreground bg-selected',
                  )}
                  onClick={() => setSelectedId(candidate.candidateId)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background">
                    {candidate.requiresCopy ? (
                      <DatabaseBackupIcon className="size-4" />
                    ) : (
                      <HardDriveIcon className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{candidate.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {copy.lastOpened}{' '}
                      <time dateTime={candidate.lastOpenedAt}>
                        {formatDateTime(candidate.lastOpenedAt, locale, candidateDateOptions)}
                      </time>
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {candidate.requiresCopy ? copy.copy : copy.open}
                  </span>
                  <CheckIcon className={cn('size-4', !active && 'invisible')} />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">{copy.noCandidates}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void cancel()}>
            {pending ? copy.cancel : copy.notNow}
          </Button>
          {!pending && candidates.length > 0 && (
            <Button
              type="button"
              data-action="migrate-legacy-space"
              disabled={!selected}
              onClick={() => void migrate()}
            >
              {copy.migrate}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
