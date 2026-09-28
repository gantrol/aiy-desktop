import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { AlbumPickerPanel, type AlbumPickerNullOption } from '@/renderer/components/albums/AlbumPickerPanel';
import { buildAlbumPickerIndex, type AlbumPickerOption } from '@/renderer/components/albums/albumPickerModel';
import { useAlbumPickerSurface } from '@/renderer/components/albums/useAlbumPickerSurface';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  options: readonly AlbumPickerOption[];
  value: string | null;
  ariaLabel: string;
  nullOption?: AlbumPickerNullOption;
  placeholder?: string;
  id?: string;
  className?: string;
  variant?: 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  onValueChange(id: string | null): void | Promise<void>;
  onOpenChange?(open: boolean): void;
  onRequestCreate?(parentId: string | null): void;
  onError?(reason: unknown): void;
}

export function AlbumSelect({
  options,
  value,
  ariaLabel,
  nullOption,
  placeholder,
  id,
  className,
  variant = 'outline',
  disabled,
  loading,
  onValueChange,
  onOpenChange,
  onRequestCreate,
  onError,
}: Props) {
  const copy = useI18n().messages.albumPicker;
  const index = useMemo(() => buildAlbumPickerIndex(options), [options]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);
  const restoreFocus = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useAlbumPickerSurface(open, trigger);
  const selected = value ? index.byId.get(value) : undefined;
  const label =
    selected?.title ??
    (value ? (loading ? copy.loading : copy.unavailable) : (nullOption?.label ?? placeholder ?? copy.choose));

  function changeOpen(next: boolean) {
    if (running.current || (next && disabled)) return;
    if (next) {
      restoreFocus.current = true;
      setQuery('');
      setParentId(selected?.parentId ?? null);
      setError(false);
    }
    setOpen(next);
    onOpenChange?.(next);
  }

  async function select(next: string | null) {
    if (running.current || disabled || loading) return;
    if (next === null ? !nullOption || nullOption.disabled : !index.byId.has(next) || index.byId.get(next)?.disabled)
      return;
    running.current = true;
    setBusy(true);
    setError(false);
    try {
      await onValueChange(next);
      setOpen(false);
      onOpenChange?.(false);
    } catch (reason) {
      setError(true);
      onError?.(reason);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="dialog"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled || busy}
          variant={variant}
          title={selected?.path ?? label}
          className={cn('min-w-0 w-full justify-between gap-2 px-3 font-normal', className)}
        >
          <span className="min-w-0 truncate">{label}</span>
          {busy ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      {surface.compact && <PopoverAnchor virtualRef={surface.virtualRef} />}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={surface.compact ? 0 : 5}
        collisionBoundary={surface.boundary}
        collisionPadding={8}
        avoidCollisions={!surface.compact}
        aria-label={ariaLabel}
        className="flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md p-0 [-webkit-app-region:no-drag]"
        style={{
          width: surface.width,
          height: surface.compact ? surface.height : undefined,
          maxHeight: surface.height,
        }}
        onEscapeKeyDown={(event) => {
          if (running.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocus.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (running.current) event.preventDefault();
        }}
      >
        <AlbumPickerPanel
          index={index}
          value={value}
          label={ariaLabel}
          nullOption={nullOption}
          parentId={parentId}
          query={query}
          loading={loading}
          busy={busy || Boolean(disabled)}
          error={error}
          onQueryChange={setQuery}
          onNavigate={setParentId}
          onSelect={(next) => void select(next)}
          onClose={() => changeOpen(false)}
          onCreate={
            onRequestCreate
              ? (parent) => {
                  restoreFocus.current = false;
                  changeOpen(false);
                  onRequestCreate(parent);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
