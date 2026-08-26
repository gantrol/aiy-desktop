import { CheckIcon, ChevronRightIcon, ChevronsUpDownIcon, FolderIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { buildAlbumTreeIndex, flattenAlbumTree, type AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';

export interface SearchableAlbumSelectLabels {
  ariaLabel: string;
  unfiled: string;
  searchPlaceholder: string;
  empty: string;
  create: string;
  createChild: string;
}

interface Props {
  albums: readonly AlbumDto[];
  value: string | null;
  labels: SearchableAlbumSelectLabels;
  className?: string;
  disabled?: boolean;
  onValueChange(value: string | null): void;
  onRequestCreate(parent: AlbumDto | null): void;
}

interface AlbumSearchRow {
  album: AlbumDto;
  path: string;
  parentPath: string;
}

function normalizeSearch(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function albumPath(tree: AlbumTreeIndex, album: AlbumDto) {
  const albums = [album];
  const visited = new Set([album.id]);
  let parentId = tree.parentById.get(album.id);
  while (parentId && !visited.has(parentId)) {
    const parent = tree.byId.get(parentId);
    if (!parent) break;
    albums.unshift(parent);
    visited.add(parentId);
    parentId = tree.parentById.get(parentId);
  }
  return albums;
}

function AlbumOption({
  album,
  selected,
  hasChildren,
  onPointerEnter,
  onSelect,
}: {
  album: AlbumDto;
  selected: boolean;
  hasChildren: boolean;
  onPointerEnter(): void;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-haspopup={hasChildren ? 'menu' : undefined}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-selected text-selected-foreground',
      )}
      onPointerEnter={onPointerEnter}
      onFocus={onPointerEnter}
      onClick={onSelect}
    >
      <CheckIcon className={cn('size-3.5 shrink-0', !selected && 'invisible')} />
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate" title={album.title}>
        {album.title}
      </span>
      {hasChildren && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function AlbumMenuPanel({
  albums,
  tree,
  value,
  parent,
  labels,
  onSelect,
  onRequestCreate,
}: {
  albums: readonly AlbumDto[];
  tree: AlbumTreeIndex;
  value: string | null;
  parent: AlbumDto | null;
  labels: SearchableAlbumSelectLabels;
  onSelect(value: string | null): void;
  onRequestCreate(parent: AlbumDto | null): void;
}) {
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);

  return (
    <div role="listbox" aria-label={labels.ariaLabel} className="max-h-72 overflow-y-auto p-1">
      {!parent && (
        <button
          type="button"
          role="option"
          aria-selected={value === null}
          className={cn(
            'flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            value === null && 'bg-selected text-selected-foreground',
          )}
          onPointerEnter={() => setOpenAlbumId(null)}
          onFocus={() => setOpenAlbumId(null)}
          onClick={() => onSelect(null)}
        >
          <CheckIcon className={cn('size-3.5 shrink-0', value !== null && 'invisible')} />
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{labels.unfiled}</span>
        </button>
      )}

      {albums.map((album) => {
        const children = (tree.childrenByParentId.get(album.id) ?? []).filter(
          (child) => !tree.effectivelyArchived.has(child.id),
        );
        const row = (
          <AlbumOption
            album={album}
            selected={value === album.id}
            hasChildren={children.length > 0}
            onPointerEnter={() => setOpenAlbumId(children.length ? album.id : null)}
            onSelect={() => onSelect(album.id)}
          />
        );
        if (!children.length) return <div key={album.id}>{row}</div>;
        return (
          <Popover key={album.id} open={openAlbumId === album.id}>
            <PopoverAnchor asChild>
              <div>{row}</div>
            </PopoverAnchor>
            <PopoverContent
              side="right"
              align="start"
              sideOffset={2}
              collisionPadding={8}
              className="w-64 overflow-visible p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <AlbumMenuPanel
                albums={children}
                tree={tree}
                value={value}
                parent={album}
                labels={labels}
                onSelect={onSelect}
                onRequestCreate={onRequestCreate}
              />
            </PopoverContent>
          </Popover>
        );
      })}

      <div className="-mx-1 mt-1 border-t px-1 pt-1">
        <button
          type="button"
          className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onPointerEnter={() => setOpenAlbumId(null)}
          onFocus={() => setOpenAlbumId(null)}
          onClick={() => onRequestCreate(parent)}
        >
          <PlusIcon className="size-4 shrink-0" />
          {parent ? labels.createChild : labels.create}
        </button>
      </div>
    </div>
  );
}

function AlbumSearchResults({
  rows,
  value,
  labels,
  onSelect,
  onRequestCreate,
}: {
  rows: readonly AlbumSearchRow[];
  value: string | null;
  labels: SearchableAlbumSelectLabels;
  onSelect(value: string | null): void;
  onRequestCreate(parent: AlbumDto | null): void;
}) {
  return (
    <div role="listbox" aria-label={labels.ariaLabel} className="max-h-72 overflow-y-auto p-1">
      {!rows.length && <p className="px-3 py-8 text-center text-xs text-muted-foreground">{labels.empty}</p>}
      {rows.map(({ album, parentPath }) => (
        <button
          key={album.id}
          type="button"
          role="option"
          aria-selected={value === album.id}
          className={cn(
            'flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            value === album.id && 'bg-selected text-selected-foreground',
          )}
          onClick={() => onSelect(album.id)}
        >
          <CheckIcon className={cn('size-3.5 shrink-0', value !== album.id && 'invisible')} />
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{album.title}</span>
            {parentPath && <span className="block truncate text-xs text-muted-foreground">{parentPath}</span>}
          </span>
        </button>
      ))}
      <div className="-mx-1 mt-1 border-t px-1 pt-1">
        <button
          type="button"
          className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onRequestCreate(null)}
        >
          <PlusIcon className="size-4 shrink-0" />
          {labels.create}
        </button>
      </div>
    </div>
  );
}

export function SearchableAlbumSelect({
  albums,
  value,
  labels,
  className,
  disabled = false,
  onValueChange,
  onRequestCreate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildAlbumTreeIndex(albums), [albums]);
  const searchRows = useMemo<AlbumSearchRow[]>(
    () =>
      flattenAlbumTree(tree).map(({ album }) => {
        const path = albumPath(tree, album);
        return {
          album,
          path: path.map((entry) => entry.title).join(' / '),
          parentPath: path
            .slice(0, -1)
            .map((entry) => entry.title)
            .join(' / '),
        };
      }),
    [tree],
  );
  const normalizedQuery = normalizeSearch(query);
  const filteredRows = normalizedQuery
    ? searchRows.filter((row) => normalizeSearch(row.path).includes(normalizedQuery))
    : [];
  const selected = value ? tree.byId.get(value) : null;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function select(nextValue: string | null) {
    onValueChange(nextValue);
    setOpen(false);
  }

  function requestCreate(parent: AlbumDto | null) {
    setOpen(false);
    onRequestCreate(parent);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-label={labels.ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          variant="outline"
          className={cn('h-11 w-full justify-between gap-2 px-3 font-normal', className)}
        >
          <span className="truncate">{selected?.title ?? labels.unfiled}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={5} className="w-72 max-w-[calc(100vw-1rem)] overflow-visible p-0">
        <div className="flex h-10 items-center gap-2 border-b px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="h-full border-0 bg-transparent px-0 shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
            placeholder={labels.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {normalizedQuery ? (
          <AlbumSearchResults
            rows={filteredRows}
            value={value}
            labels={labels}
            onSelect={select}
            onRequestCreate={requestCreate}
          />
        ) : (
          <AlbumMenuPanel
            albums={tree.activeRoots}
            tree={tree}
            value={value}
            parent={null}
            labels={labels}
            onSelect={select}
            onRequestCreate={requestCreate}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
