import { useRef, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList } from '@/renderer/components/ui/command';
import { moveWorkCell } from '@/renderer/features/work-tracking/WorkTableEditing';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export function WorkChoiceCell<T extends string>({
  value,
  label,
  display,
  options,
  labels,
  version,
  disabled,
  onSave,
}: {
  value: string;
  label: string;
  display?: string;
  options: readonly T[];
  labels: Record<NoInfer<T>, string>;
  version: number;
  disabled: boolean;
  onSave(value: T, version: number): Promise<boolean>;
}) {
  const l = useI18n().messages.workTracking;
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const nextFocus = useRef<(() => void) | null>(null);
  const pending = useRef(false);
  const revision = useRef(version);
  const trigger = useRef<HTMLButtonElement>(null);
  const choose = async (next: T, direction = 0) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const focus = trigger.current && moveWorkCell(trigger.current, direction);
      const ok = next === value || (await onSave(next, revision.current));
      setFailed(!ok);
      if (ok) {
        nextFocus.current = focus;
        setOpen(false);
        focus?.();
      } else {
        setHighlighted(next);
      }
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending.current) return;
        if (next) {
          revision.current = version;
          setFailed(false);
          setHighlighted(options.includes(value as T) ? value : (options[0] ?? ''));
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          data-work-cell
          variant="ghost"
          size="sm"
          className="w-full justify-start px-0 text-left text-sm font-normal hover:bg-hover-strong focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=open]:bg-hover-strong"
          disabled={disabled && !open}
          aria-label={label}
        >
          {display ?? labels[value as T] ?? l.untracked}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-1"
        align="start"
        onCloseAutoFocus={(event) => {
          if (nextFocus.current) {
            event.preventDefault();
            nextFocus.current = null;
          }
        }}
        onInteractOutside={(event) => {
          if (pending.current || failed) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending.current) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            if (pending.current || !options.includes(highlighted as T)) return;
            void choose(highlighted as T, event.shiftKey ? -1 : 1);
          }
        }}
      >
        <Command
          label={label}
          tabIndex={0}
          value={highlighted}
          onValueChange={setHighlighted}
          onKeyDownCapture={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <CommandList ariaLabel={label}>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} value={option} disabled={saving} onSelect={() => void choose(option)}>
                  <CheckIcon aria-hidden="true" className={cn('size-3.5 shrink-0', option !== value && 'invisible')} />
                  {labels[option]}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {failed && (
          <span role="alert" className="block p-2 text-xs text-destructive">
            {l.cellSaveFailed}
          </span>
        )}
      </PopoverContent>
    </Popover>
  );
}
