import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/renderer/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
  keywords?: string;
  group?: string;
  description?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onValueChange(value: string): void;
  ariaLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}

function Combobox({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled = false,
  className,
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);
  const groups = options.reduce<Map<string, ComboboxOption[]>>((result, option) => {
    const key = option.group ?? '';
    result.set(key, [...(result.get(key) ?? []), option]);
    return result;
  }, new Map());

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          variant="outline"
          className={cn('min-w-40 justify-between gap-2 px-3 font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn('w-[var(--radix-popover-trigger-width)] min-w-56 p-0', contentClassName)}
      >
        <Command label={ariaLabel}>
          <CommandInput autoFocus placeholder={searchPlaceholder} />
          <CommandList ariaLabel={ariaLabel}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {[...groups].map(([group, groupOptions]) => (
              <CommandGroup key={group || '__ungrouped'} heading={group || undefined}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.keywords ?? ''} ${option.value}`}
                    disabled={option.disabled}
                    data-current={option.value === value || undefined}
                    className={
                      option.value === value
                        ? 'bg-selected text-selected-foreground data-[selected=true]:bg-selected'
                        : undefined
                    }
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={cn('size-3.5 shrink-0', option.value !== value && 'invisible')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
