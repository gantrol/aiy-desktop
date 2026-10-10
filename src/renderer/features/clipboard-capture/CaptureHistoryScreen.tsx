import { useState } from 'react';
import { Settings2, RefreshCw, ListChecks, Trash2 } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useClipboardHistory } from '@/renderer/features/clipboard-capture/useClipboardHistory';
import { CaptureToolButton } from '@/renderer/features/clipboard-capture/CaptureToolButton';
import { CaptureButton } from '@/renderer/features/clipboard-capture/CaptureButton';
import { CaptureHistoryThumbnail } from '@/renderer/features/clipboard-capture/CaptureHistoryThumbnail';
import { CaptureHistoryActions } from '@/renderer/features/clipboard-capture/CaptureHistoryActions';
import { ClipboardSettingsDialog } from '@/renderer/features/clipboard-capture/ClipboardSettingsDialog';
import type { ClipboardEntry } from '@/shared/contracts/clipboard-capture';

export function CaptureHistoryScreen({ active, notify }: { active: boolean; notify(message: string): void }) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const controller = useClipboardHistory(active, notify, true, 'capture');
  const { items, selected, busy, status, run } = controller;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const title = (item: ClipboardEntry) =>
    item.title ||
    l.captureTitle.replace(
      '{time}',
      new Date(item.createdAt).toLocaleString(locale, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  if (!active) return null;
  return (
    <section className="grid min-w-0 gap-2" aria-label={l.captureHistory}>
      <div className="flex items-center gap-1">
        <Input
          className="min-w-0 flex-1"
          placeholder={l.captureSearch}
          aria-label={l.captureSearch}
          value={controller.query}
          maxLength={128}
          onChange={(event) => controller.search(event.target.value)}
        />
        <CaptureButton controller={controller} />
        <CaptureToolButton label={l.settings} disabled={!status || busy} onClick={() => setSettingsOpen(true)}>
          <Settings2 />
        </CaptureToolButton>
        <CaptureToolButton
          label={controller.hasUpdates ? l.newItems : l.refresh}
          disabled={busy}
          onClick={controller.refresh}
        >
          <RefreshCw />
        </CaptureToolButton>
      </div>
      <div className="flex min-h-8 items-center gap-1">
        <Button
          variant={controller.filter === 'pinned' ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={controller.filter === 'pinned'}
          onClick={() => controller.changeFilter(controller.filter === 'pinned' ? 'all' : 'pinned')}
        >
          {l.pinned}
        </Button>
        <CaptureToolButton
          label={l.selectPage}
          aria-pressed={multiple}
          onClick={() => {
            setMultiple(!multiple);
            setChecked([]);
          }}
        >
          <ListChecks />
        </CaptureToolButton>
        {multiple && (
          <CaptureToolButton
            label={l.deleteSelected}
            disabled={!checked.length || busy}
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
          </CaptureToolButton>
        )}
        {selected && !multiple && (
          <div className="ml-auto">
            <CaptureHistoryActions key={selected.id} controller={controller} title={title(selected)} />
          </div>
        )}
      </div>
      {(controller.error || status?.error) && (
        <span role="alert" className="text-sm text-destructive">
          {controller.error || controller.errorText(status!.error!)}
        </span>
      )}
      {status && !status.settings.recording && (
        <div className="flex items-center gap-2 text-xs">
          <span>{l.paused}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run({ kind: 'configure', settings: { ...status.settings, recording: true } })}
          >
            {l.resume}
          </Button>
        </div>
      )}
      <div
        className="max-h-[36rem] overflow-auto border-y"
        onKeyDown={(event) => {
          if (!(event.target as Element).closest('[data-capture-history-item]')) return;
          if (event.key === 'Enter' && selected) {
            event.preventDefault();
            void run({ kind: 'copy', id: selected.id });
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const next = Math.max(
            0,
            Math.min(
              items.length - 1,
              items.findIndex((item) => item.id === selected?.id) + (event.key === 'ArrowDown' ? 1 : -1),
            ),
          );
          if (items[next]) {
            controller.setSelected(items[next]);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-capture-history-item]')[next]?.focus();
          }
        }}
      >
        {!items.length && (
          <p className="p-3 text-sm text-muted-foreground">
            {controller.query || controller.filter === 'pinned' ? l.noResults : l.captureEmpty}
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 border-b last:border-b-0">
            {multiple && (
              <Checkbox
                className="ml-2"
                aria-label={`${l.selectItem}: ${title(item)}`}
                checked={checked.includes(item.id)}
                onCheckedChange={(value) =>
                  setChecked((ids) => (value ? [...new Set([...ids, item.id])] : ids.filter((id) => id !== item.id)))
                }
              />
            )}
            <Button
              data-capture-history-item
              variant={selected?.id === item.id ? 'secondary' : 'ghost'}
              aria-pressed={selected?.id === item.id}
              className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-2 py-2 text-left"
              onClick={() => controller.setSelected(item)}
            >
              <CaptureHistoryThumbnail id={item.id} execute={controller.execute} />
              <span className="grid min-w-0 gap-1">
                <span className="truncate">
                  {item.pinned ? '• ' : ''}
                  {title(item)}
                  {item.source === 'capture-partial' && (
                    <span className="ml-2 text-xs text-muted-foreground">{l.selection.scrollPartial}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.width && item.height
                    ? `${item.width.toLocaleString(locale)} × ${item.height.toLocaleString(locale)}`
                    : ''}
                </span>
              </span>
            </Button>
          </div>
        ))}
      </div>
      {(controller.offsets.length > 1 || controller.nextOffset !== null) && (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={controller.offsets.length <= 1 || busy}
            onClick={controller.previous}
          >
            {l.previous}
          </Button>
          <Button variant="ghost" size="sm" disabled={controller.nextOffset === null || busy} onClick={controller.next}>
            {l.next}
          </Button>
        </div>
      )}
      {settingsOpen && status && (
        <ClipboardSettingsDialog controller={controller} status={status} onClose={() => setSettingsOpen(false)} />
      )}
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{l.confirmMany}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
              {l.cancel}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run({ kind: 'removeMany', ids: checked }).then((ok) => {
                  if (ok) {
                    setChecked([]);
                    setDeleting(false);
                  }
                })
              }
            >
              {l.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
