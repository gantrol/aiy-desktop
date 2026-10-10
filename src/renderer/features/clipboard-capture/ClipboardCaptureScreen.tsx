import { useState } from 'react';
import { Settings2, RefreshCw, ListChecks, Eye } from 'lucide-react';
import { CaptureToolButton } from '@/renderer/features/clipboard-capture/CaptureToolButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useClipboardHistory, type ClipboardFilter } from '@/renderer/features/clipboard-capture/useClipboardHistory';
import { ClipboardSettingsDialog } from '@/renderer/features/clipboard-capture/ClipboardSettingsDialog';
import { ClipboardEntryDetails } from '@/renderer/features/clipboard-capture/ClipboardEntryDetails';
import { ClipboardHistoryActions } from '@/renderer/features/clipboard-capture/ClipboardHistoryActions';
import { ClipboardRecordingControls } from '@/renderer/features/clipboard-capture/ClipboardRecordingControls';

export function ClipboardCaptureScreen({
  active,
  spaceId,
  notify,
  onOpenPermissions,
}: {
  active: boolean;
  spaceId: string;
  notify(message: string): void;
  onOpenPermissions?(): void;
}) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const controller = useClipboardHistory(active, notify);
  const { status, items, query, filter, selected, busy, error, run, errorText } = controller;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [multiple, setMultiple] = useState(false);
  const [preview, setPreview] = useState(false);
  if (!active) return null;
  return (
    <section aria-label={l.title} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-40 flex-1"
          value={query}
          maxLength={128}
          aria-label={l.search}
          placeholder={l.search}
          onChange={(event) => controller.search(event.target.value)}
        />
        <Select value={filter} onValueChange={(value) => controller.changeFilter(value as ClipboardFilter)}>
          <SelectTrigger aria-label={l.title}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'image', 'text', 'pinned'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {l[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardRecordingControls controller={controller} onOpenPermissions={onOpenPermissions} />
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
        <ClipboardHistoryActions
          controller={controller}
          checked={checked}
          onChecked={setChecked}
          selectionMode={multiple}
        />
        {selected && !multiple && (
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              disabled={busy || !status?.supported}
              onClick={() => void run({ kind: 'copy', id: selected.id })}
            >
              {l.copy}
            </Button>
            <CaptureToolButton label={l.preview} onClick={() => setPreview(true)}>
              <Eye />
            </CaptureToolButton>
          </div>
        )}
      </div>
      {(error || status?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || errorText(status!.error!)}
        </p>
      )}
      <div className="min-h-48">
        <div
          className="max-h-[32rem] overflow-auto border-y"
          aria-label={l.title}
          onKeyDown={(event) => {
            if (!event.target || !(event.target as Element).closest('[data-history-item]')) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const index = items.findIndex((item) => item.id === selected?.id);
              const next = Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
              if (items[next]) {
                controller.setSelected(items[next]);
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-history-item]')[next]?.focus();
              }
            } else if (
              selected &&
              (event.key === 'Enter' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c'))
            ) {
              event.preventDefault();
              void run({ kind: event.shiftKey && selected.kind !== 'image' ? 'copyPlain' : 'copy', id: selected.id });
            }
          }}
        >
          {!items.length && (
            <p className="p-3 text-sm text-muted-foreground">{query || filter !== 'all' ? l.noResults : l.empty}</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-1 pl-2">
              {multiple && (
                <Checkbox
                  checked={checked.includes(item.id)}
                  disabled={busy}
                  aria-label={`${l.selectItem}: ${item.preview || l[item.kind]}`}
                  onCheckedChange={(value) =>
                    setChecked((ids) =>
                      value === true
                        ? [...ids.filter((id) => id !== item.id), item.id]
                        : ids.filter((id) => id !== item.id),
                    )
                  }
                />
              )}
              <Button
                data-history-item
                variant={item.id === selected?.id ? 'secondary' : 'ghost'}
                className="h-auto w-full justify-start rounded-none px-3 py-2 text-left"
                aria-pressed={item.id === selected?.id}
                onClick={() => controller.setSelected(item)}
              >
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="truncate">
                    {item.pinned ? '• ' : ''}
                    {item.preview || l[item.kind]}
                  </span>
                  <span className="flex gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{item.source || l[item.kind]}</span>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString(locale, {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </span>
                </span>
              </Button>
            </div>
          ))}
        </div>
      </div>
      <Dialog open={preview && Boolean(selected)} onOpenChange={setPreview}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l.preview}</DialogTitle>
          </DialogHeader>
          {selected && (
            <ClipboardEntryDetails key={selected.id} entry={selected} spaceId={spaceId} controller={controller} />
          )}
        </DialogContent>
      </Dialog>
      <div className="flex gap-2">
        <Button variant="outline" disabled={controller.offsets.length <= 1 || busy} onClick={controller.previous}>
          {l.previous}
        </Button>
        <Button variant="outline" disabled={controller.nextOffset === null || busy} onClick={controller.next}>
          {l.next}
        </Button>
      </div>
      {settingsOpen && status && (
        <ClipboardSettingsDialog
          controller={controller}
          status={status}
          onClose={() => setSettingsOpen(false)}
          onOpenPermissions={onOpenPermissions}
        />
      )}
    </section>
  );
}
