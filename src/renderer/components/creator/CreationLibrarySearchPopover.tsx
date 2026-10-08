import { useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { CreationLibrarySearchButton } from '@/renderer/components/creator/CreationLibrarySearchButton';
import { CreationLibraryToolbar } from '@/renderer/components/creator/CreationLibraryToolbar';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props extends Omit<ComponentProps<typeof CreationLibraryToolbar>, 'searchOpen' | 'onSearchOpenChange'> {
  open: boolean;
  onOpenChange(open: boolean): void;
  restoreFocus: RefObject<boolean>;
  children: ReactNode;
}

export function CreationLibrarySearchPopover({ open, onOpenChange, restoreFocus, children, ...toolbar }: Props) {
  const labels = useI18n().messages.creator.results;
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <CreationLibrarySearchButton />
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="start"
        sideOffset={12}
        collisionPadding={8}
        aria-label={labels.search}
        className="flex h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-16px)] flex-col overflow-hidden bg-surface-sunken p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocus.current) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing) {
            event.preventDefault();
            return;
          }
          // Radix handles Escape before the input's bubbling key handler.
          if (event.target === inputRef.current && toolbar.query) {
            event.preventDefault();
            toolbar.onQueryChange('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || event.nativeEvent.isComposing || event.target !== inputRef.current) return;
          const firstResult = contentRef.current?.querySelector<HTMLButtonElement>(
            '[data-action="open-creation-tree-item"]:not(:disabled)',
          );
          if (!firstResult) return;
          event.preventDefault();
          firstResult.focus();
        }}
      >
        <div className="relative h-10 shrink-0 border-b">
          <CreationLibraryToolbar {...toolbar} inputRef={inputRef} searchOpen onSearchOpenChange={onOpenChange} />
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
