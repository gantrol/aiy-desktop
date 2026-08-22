import { useState } from 'react';
import { EraserIcon, LoaderCircleIcon } from 'lucide-react';
import type { CodexUsageCleanupLevel, CodexUsageCleanupResult } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import type { useI18n } from '@/renderer/i18n/useI18n';

type CleanupLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['cleanup'];

const cleanupLevels: CodexUsageCleanupLevel[] = ['HISTORY', 'ANALYSIS_CACHE', 'LOCAL_INDEX'];

export function CodexUsageCleanupControl({
  disabled,
  labels,
  notify,
  onCleared,
  onError,
}: {
  disabled: boolean;
  labels: CleanupLabels;
  notify(message: string): void;
  onCleared(result: CodexUsageCleanupResult): void;
  onError(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<CodexUsageCleanupLevel>('HISTORY');
  const [busy, setBusy] = useState(false);

  async function clearLocalData() {
    if (disabled || busy) return;
    setBusy(true);
    onError('');
    try {
      const result = await window.desktopApi.codexUsageClear({ level });
      onCleared(result);
      setOpen(false);
      notify(labels.notices[result.level]);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => setOpen(true)}>
        <EraserIcon className="size-4" />
        {labels.action}
      </Button>
      <CodexUsageCleanupDialog
        open={open}
        level={level}
        busy={busy}
        labels={labels}
        onLevelChange={setLevel}
        onOpenChange={setOpen}
        onConfirm={() => void clearLocalData()}
      />
    </>
  );
}

export function CodexUsageCleanupDialog({
  open,
  level,
  busy,
  labels,
  onLevelChange,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  level: CodexUsageCleanupLevel;
  busy: boolean;
  labels: CleanupLabels;
  onLevelChange(value: CodexUsageCleanupLevel): void;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-dialog="codex-usage-cleanup" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.descriptions[level]}</DialogDescription>
        </DialogHeader>
        <Segmented
          type="single"
          value={level}
          disabled={busy}
          className="grid h-auto w-full grid-cols-3"
          aria-label={labels.level}
          onValueChange={(value) => value && onLevelChange(value as CodexUsageCleanupLevel)}
        >
          {cleanupLevels.map((value) => (
            <SegmentedItem key={value} value={value} className="h-8 px-2">
              {labels.levels[value]}
            </SegmentedItem>
          ))}
        </Segmented>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={onConfirm}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {busy ? labels.clearing : labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
