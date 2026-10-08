import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, GalleryVerticalEndIcon, PlusIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Command, CommandInput, CommandItem, CommandList } from '@/renderer/components/ui/command';
import {
  normalizeAlbumSearch,
  searchAlbumPicker,
  type AlbumPickerIndex,
} from '@/renderer/components/albums/albumPickerModel';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface AlbumPickerNullOption {
  kind: 'unassigned' | 'default' | 'root';
  label: string;
  disabled?: boolean;
}

interface Props {
  index: AlbumPickerIndex;
  value: string | null;
  label: string;
  nullOption?: AlbumPickerNullOption;
  parentId: string | null;
  query: string;
  loading?: boolean;
  busy: boolean;
  error: boolean;
  onQueryChange(query: string): void;
  onNavigate(id: string | null): void;
  onSelect(id: string | null): void;
  onClose?(): void;
  onCreate?(parentId: string | null): void;
}

export function AlbumPickerPanel({
  index,
  value,
  label,
  nullOption,
  parentId,
  query,
  loading,
  busy,
  error,
  onQueryChange,
  onNavigate,
  onSelect,
  onClose,
  onCreate,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.albumPicker;
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState('');
  const searching = Boolean(normalizeAlbumSearch(query));
  const parent = parentId ? index.byId.get(parentId) : undefined;
  const rows = searching ? searchAlbumPicker(index, query) : (index.childrenById.get(parent?.id ?? null) ?? []);
  const disabled = busy || loading;
  function navigate(id: string | null) {
    if (disabled) return;
    onNavigate(id);
    onQueryChange('');
    setActive('');
    input.current?.focus();
  }
  return (
    <Command
      label={label}
      shouldFilter={false}
      value={active}
      onValueChange={setActive}
      className="h-auto min-h-0 max-h-[inherit] flex-1 rounded-none"
      onKeyDownCapture={(event) => {
        // Native buttons own activation; cmdk must not also select the highlighted album.
        if (
          event.target instanceof Element &&
          event.target.closest('button') &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        // Preserve text editing keys, including IME composition, inside the search field.
        if (event.nativeEvent.isComposing || event.target instanceof HTMLInputElement) return;
        if (event.key === 'ArrowLeft' && parent) {
          event.preventDefault();
          navigate(parent.parentId);
        }
        if (event.key === 'ArrowRight' && active.startsWith('album:')) {
          const id = active.slice(6);
          if (index.childrenById.has(id)) {
            event.preventDefault();
            navigate(id);
          }
        }
      }}
    >
      <div className="flex shrink-0 items-center border-b [&_[data-slot=command-input-wrapper]]:min-w-0 [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:border-0">
        <CommandInput
          ref={input}
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder={copy.search}
          aria-label={copy.search}
          disabled={busy}
        />
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mr-1 shrink-0"
            aria-label={messages.common.close}
            disabled={busy}
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
      {parent && !searching && (
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 justify-start rounded-none px-3 font-normal"
          title={parent.path}
          aria-label={copy.back}
          disabled={disabled}
          onClick={() => navigate(parent.parentId)}
        >
          <ArrowLeftIcon className="size-4" />
          <span className="min-w-0 truncate">{parent.path}</span>
        </Button>
      )}
      <CommandList ariaLabel={label} aria-busy={disabled} className="min-h-0 max-h-none flex-1 overscroll-contain">
        {loading ? (
          <div role="status" className="px-3 py-4 text-xs text-muted-foreground">
            {copy.loading}
          </div>
        ) : (
          <>
            {!searching && !parent && nullOption && (
              <CommandItem
                value={`special:${nullOption.kind}`}
                disabled={busy || nullOption.disabled}
                onSelect={() => onSelect(null)}
              >
                <CheckIcon className={cn('size-3.5 shrink-0', value !== null && 'invisible')} />
                <span className="min-w-0 truncate">{nullOption.label}</span>
              </CommandItem>
            )}
            {rows.map((row) => (
              <div key={row.id} className="flex min-w-0 items-center">
                <CommandItem
                  value={`album:${row.id}`}
                  disabled={busy || row.disabled}
                  onSelect={() => onSelect(row.id)}
                  title={row.path}
                  className={cn(
                    'min-w-0 flex-1',
                    value === row.id &&
                      'bg-selected text-selected-foreground data-[selected=true]:bg-selected data-[selected=true]:text-selected-foreground',
                  )}
                >
                  <GalleryVerticalEndIcon className="size-4 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.title}</span>
                    {searching && row.parentPath && (
                      <span className="block truncate text-xs text-muted-foreground">{row.parentPath}</span>
                    )}
                  </span>
                  {value === row.id && <CheckIcon className="size-3.5 shrink-0" />}
                </CommandItem>
                {index.childrenById.has(row.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-sm"
                    disabled={busy}
                    aria-label={copy.enter(row.title)}
                    onFocus={() => setActive(`album:${row.id}`)}
                    onClick={() => navigate(row.id)}
                  >
                    <ChevronRightIcon className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {!rows.length && (
              <div role="status" className="px-3 py-4 text-xs text-muted-foreground">
                {searching ? copy.noResults : copy.noAlbums}
              </div>
            )}
          </>
        )}
      </CommandList>
      {error && (
        <div role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {copy.failed}
        </div>
      )}
      {onCreate && (
        <div className="shrink-0 border-t p-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start font-normal"
            disabled={disabled}
            onClick={() => onCreate(searching ? null : (parent?.id ?? null))}
          >
            <PlusIcon className="size-4" />
            {parent && !searching ? messages.gallery.albums.createChild : messages.gallery.albums.create}
          </Button>
        </div>
      )}
    </Command>
  );
}
