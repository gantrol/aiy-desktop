import { ArrowDownIcon, ArrowUpIcon, FileTextIcon, ImageIcon, VideoIcon, XIcon } from 'lucide-react';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import { isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';

interface Props {
  items: LocalIntakeItem[];
  disabled: boolean;
  onEditText(id: string, text: string): void;
  onMove(id: string, offset: -1 | 1): void;
  onRemove(id: string): void;
}

export function IntakeDraftTray({ items, disabled, onEditText, onMove, onRemove }: Props) {
  const { messages } = useI18n();
  const l = messages.intake.draft;
  return (
    <div data-slot="intake-draft-tray" className="mx-auto flex w-full max-w-3xl flex-col border-y bg-background">
      {items.map((item, index) => (
        <div
          key={item.id}
          data-intake-item={item.kind}
          className="flex min-h-20 items-center gap-3 border-b px-3 py-3 last:border-b-0"
        >
          {item.kind !== 'TEXT' ? (
            <img
              data-slot="intake-preview"
              className="size-16 shrink-0 rounded-md border bg-media-surround-light object-contain"
              src={item.previewUrl}
              alt=""
            />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center text-muted-foreground">
              <FileTextIcon className="size-5" />
              <span className="sr-only">{l.text}</span>
            </span>
          )}
          <div className="min-w-0 flex-1">
            {item.kind === 'TEXT' ? (
              <Textarea
                className="min-h-16 resize-y border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                value={item.text}
                disabled={disabled}
                onChange={(event) => onEditText(item.id, event.target.value)}
              />
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                {isIntakeVideoMimeType(item.mimeType) ? (
                  <VideoIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm">{item.name}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === 0}
              title={l.up}
              aria-label={l.up}
              onClick={() => onMove(item.id, -1)}
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === items.length - 1}
              title={l.down}
              aria-label={l.down}
              onClick={() => onMove(item.id, 1)}
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              title={l.remove}
              aria-label={l.remove}
              onClick={() => onRemove(item.id)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
