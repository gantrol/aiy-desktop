import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';

export interface ComboboxInputSuggestion {
  value: string;
  group?: string;
  keywords?: readonly string[];
}
export type ComboboxInputSuggestionValue = string | ComboboxInputSuggestion;

interface Props extends Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'list'> {
  value: string;
  suggestions: readonly ComboboxInputSuggestionValue[];
  openLabel: string;
  onValueChange(value: string): void;
}

/**
 * A text field that offers known values without closing the set: anything the
 * user types is a valid value. Use where the catalog is advisory rather than
 * authoritative, such as model-family and source-service names.
 */
export function ComboboxInput({ value, suggestions, openLabel, onValueChange, className, disabled, ...props }: Props) {
  const [open, setOpen] = React.useState(false);
  const [typing, setTyping] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listboxId = React.useId();

  const matches = React.useMemo(() => {
    const seen = new Set<string>();
    const normalizedSuggestions = suggestions.map((suggestion) =>
      typeof suggestion === 'string' ? { value: suggestion } : suggestion,
    );
    const hasCurrentValue = normalizedSuggestions.some(
      (suggestion) => suggestion.value.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
    );
    const entries =
      typing || !value.trim() || hasCurrentValue ? normalizedSuggestions : [{ value }, ...normalizedSuggestions];
    const unique = entries.flatMap((rawEntry) => {
      const entry = { ...rawEntry, value: rawEntry.value.trim() };
      const key = entry.value.toLocaleLowerCase();
      if (!entry.value || seen.has(key)) return [];
      seen.add(key);
      return [entry];
    });
    const needle = value.trim().toLowerCase();
    if (!typing || !needle) return unique;
    return unique.filter((entry) =>
      [entry.value, ...(entry.keywords ?? [])].some((candidate) => candidate.toLocaleLowerCase().includes(needle)),
    );
  }, [suggestions, typing, value]);
  const visible = open && matches.length > 0;
  const groupHeaderCount = matches.reduce(
    (count, entry, index) => count + (entry.group && entry.group !== matches[index - 1]?.group ? 1 : 0),
    0,
  );

  React.useEffect(() => {
    if (open && matches.length === 0) setOpen(false);
  }, [matches.length, open]);

  React.useEffect(() => {
    if (!visible || activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId, visible]);

  function choose(entry: ComboboxInputSuggestion) {
    onValueChange(entry.value);
    setTyping(false);
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <Popover
      open={visible}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setActiveIndex(-1);
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Input
            {...props}
            ref={inputRef}
            value={value}
            disabled={disabled}
            className="pr-9"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={visible ? listboxId : undefined}
            aria-activedescendant={visible && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            aria-expanded={visible}
            onChange={(event) => {
              setTyping(true);
              setActiveIndex(-1);
              onValueChange(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && matches.length) {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((current) => (current < matches.length - 1 ? current + 1 : 0));
                return;
              }
              if (event.key === 'ArrowUp' && matches.length) {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((current) => (current > 0 ? current - 1 : matches.length - 1));
                return;
              }
              if (event.key === 'Enter' && visible && activeIndex >= 0) {
                event.preventDefault();
                choose(matches[activeIndex]);
                return;
              }
              if (event.key === 'Escape' && visible) {
                event.preventDefault();
                setOpen(false);
                setActiveIndex(-1);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={openLabel}
            title={openLabel}
            className="absolute right-0.5 top-1/2 -translate-y-1/2"
            onClick={() => {
              if (visible) {
                setOpen(false);
                setActiveIndex(-1);
                return;
              }
              setTyping(false);
              setActiveIndex(() => {
                const selectedIndex = matches.findIndex((entry) => entry.value === value);
                return selectedIndex >= 0 ? selectedIndex : 0;
              });
              setOpen(true);
            }}
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ScrollArea
          type="always"
          className="[&_[data-slot=scroll-area-scrollbar]]:opacity-100 [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:!block"
          style={{
            height: `min(${Math.min(matches.length * 32 + groupHeaderCount * 24 + 8, 320)}px, var(--radix-popover-content-available-height))`,
          }}
        >
          <ul id={listboxId} role="listbox" aria-label={openLabel} className="p-1 pr-3">
            {matches.map((entry, index) => {
              const selected = entry.value === value;
              const startsGroup = entry.group && entry.group !== matches[index - 1]?.group;
              return (
                <React.Fragment key={entry.value.toLocaleLowerCase()}>
                  {startsGroup && (
                    <li
                      role="presentation"
                      className="px-2 pb-1 pt-2 text-[0.6875rem] font-medium text-muted-foreground"
                    >
                      {entry.group}
                    </li>
                  )}
                  <li>
                    <button
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        'flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover',
                        index === activeIndex && 'bg-hover',
                        selected && 'bg-selected text-selected-foreground',
                      )}
                      onPointerMove={() => setActiveIndex(index)}
                      onClick={() => choose(entry)}
                    >
                      <CheckIcon className={cn('size-3.5 shrink-0', !selected && 'invisible')} />
                      <span className="min-w-0 flex-1 truncate">{entry.value}</span>
                    </button>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
