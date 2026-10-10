import { ChevronDownIcon, FilePenLineIcon, LightbulbIcon, LoaderCircleIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import type { AssistantWebSearchMode } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { ResponsiveButton } from '@/renderer/components/ui/responsive-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

interface Props {
  label: string;
  searchLabel: string;
  optionsLabel: string;
  disabled: boolean;
  busy: boolean;
  variant: 'ghost' | 'outline';
  responsive?: boolean;
  ideas?: { label: string; disabled: boolean; onRun(): void | Promise<void> };
  onRun(webSearchMode: AssistantWebSearchMode): void | Promise<void>;
}

export function AssistantWritingAction({
  label,
  searchLabel,
  optionsLabel,
  disabled,
  busy,
  variant,
  responsive = false,
  ideas,
  onRun,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div data-assistant-writing-action className="inline-flex items-center">
      <ResponsiveButton
        type="button"
        variant={variant}
        size="sm"
        className="rounded-r-none"
        label={label}
        responsive={responsive}
        disabled={disabled}
        aria-busy={busy}
        onClick={() => void onRun('DISABLED')}
      >
        {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FilePenLineIcon className="size-4" />}
      </ResponsiveButton>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size="sm"
            className={cn(
              'w-7 rounded-l-none px-0',
              variant === 'outline' ? 'border-l-0' : 'border-l border-border/60',
            )}
            disabled={disabled && (!ideas || ideas.disabled)}
            aria-label={optionsLabel}
            title={optionsLabel}
          >
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-44 p-1.5">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 font-normal"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              void onRun('DISABLED');
            }}
          >
            <FilePenLineIcon className="size-3.5" />
            {label}
          </Button>
          {ideas && (
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start gap-2 px-2 font-normal"
              disabled={ideas.disabled}
              onClick={() => {
                setOpen(false);
                void ideas.onRun();
              }}
            >
              <LightbulbIcon className="size-3.5" />
              {ideas.label}
            </Button>
          )}
          <Button
            type="button"
            data-action="search-and-optimize"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 font-normal"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              void onRun('REQUIRED');
            }}
          >
            <SearchIcon className="size-3.5" />
            {searchLabel}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
