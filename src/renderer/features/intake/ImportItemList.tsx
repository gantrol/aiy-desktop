import { FileTextIcon, ImageIcon, PlusIcon, VideoIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { intakeMediaAccept, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { cn } from '@/renderer/lib/utils';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';

interface Labels {
  selectAll: string;
  selected(count: number): string;
  addContent: string;
  remove: string;
  text: string;
}

interface Props {
  items: LocalIntakeItem[];
  activeId: string;
  selectedIds: ReadonlySet<string>;
  batchMode: boolean;
  disabled: boolean;
  locale: 'zh' | 'en';
  labels: Labels;
  onActiveChange(id: string): void;
  onSelectionChange(id: string, selected: boolean): void;
  onSelectAll(selected: boolean): void;
  onRemove(id: string): void;
  onAddFiles(files: File[]): void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatModified(timestamp: number, locale: Props['locale']) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function ImportItemList({
  items,
  activeId,
  selectedIds,
  batchMode,
  disabled,
  locale,
  labels,
  onActiveChange,
  onSelectionChange,
  onSelectAll,
  onRemove,
  onAddFiles,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectableIds = items.filter((item) => item.kind === 'IMAGE').map((item) => item.id);
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const selectState = allSelected ? true : selectedCount > 0 ? 'indeterminate' : false;

  return (
    <aside className="flex min-h-0 flex-col border-r bg-surface" data-slot="import-item-list">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <Checkbox
          checked={selectState}
          disabled={disabled || selectableIds.length === 0}
          aria-label={labels.selectAll}
          onCheckedChange={(checked) => onSelectAll(checked === true)}
        />
        <span className="text-sm font-medium">
          {selectedCount > 0 ? labels.selected(selectedCount) : labels.selectAll}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {items.map((item) => {
            const active = item.id === activeId;
            const selected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                data-intake-item={item.kind}
                data-active={active ? 'true' : 'false'}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'group relative flex min-h-32 items-center gap-3 px-5 py-3 transition-colors duration-fast',
                  active && 'bg-selected/70',
                  batchMode && selected && 'bg-selected/55',
                  !active && !(batchMode && selected) && 'hover:bg-hover',
                )}
              >
                {item.kind === 'IMAGE' ? (
                  <Checkbox
                    checked={selected}
                    disabled={disabled}
                    aria-label={`${labels.selectAll}: ${item.name}`}
                    onCheckedChange={(checked) => onSelectionChange(item.id, checked === true)}
                  />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={disabled}
                  onClick={() => onActiveChange(item.id)}
                >
                  {item.kind === 'IMAGE' ? (
                    <img
                      data-slot="intake-preview"
                      className="h-24 w-24 shrink-0 rounded-md border bg-media-surround-light object-contain"
                      src={item.previewUrl}
                      alt=""
                    />
                  ) : (
                    <span className="grid h-24 w-24 shrink-0 place-items-center rounded-md border bg-surface-sunken text-muted-foreground">
                      <FileTextIcon className="size-6" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="block truncate text-sm font-medium">
                      {item.kind === 'IMAGE' ? item.name : labels.text}
                    </span>
                    {item.kind === 'IMAGE' ? (
                      <>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {isIntakeVideoMimeType(item.mimeType) ? (
                            <VideoIcon className="size-3.5" />
                          ) : (
                            <ImageIcon className="size-3.5" />
                          )}
                          {item.mimeType.replace(/^(image|video)\//, '').toUpperCase()} · {formatBytes(item.file.size)}
                        </span>
                        {(item.width ?? 0) > 0 && (item.height ?? 0) > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {item.width} × {item.height}
                          </span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatModified(item.file.lastModified, locale)}
                        </span>
                      </>
                    ) : (
                      <span className="block line-clamp-3 text-xs text-muted-foreground">{item.text}</span>
                    )}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  disabled={disabled}
                  title={labels.remove}
                  aria-label={labels.remove}
                  onClick={() => onRemove(item.id)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t p-4">
        <input
          ref={inputRef}
          type="file"
          accept={intakeMediaAccept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) onAddFiles(files);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon className="size-4" />
          {labels.addContent}
        </Button>
      </div>
    </aside>
  );
}
