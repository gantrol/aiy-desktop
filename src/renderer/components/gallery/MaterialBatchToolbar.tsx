import {
  BookOpenIcon,
  CornerDownRightIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MaterialAlbumDto, TermListItem } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';
import { buildMaterialAlbumTree, flattenMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';
import { MaterialAlbumPreview } from '@/renderer/components/gallery/MaterialAlbumPreview';

interface Labels {
  selected(count: number): string;
  addTo: string;
  clear: string;
  albums: string;
  dictionary: string;
  empty: string;
  emptyTerms: string;
  imageTermsOnly: string;
  searchDestinations: string;
  addDestinationCount(count: number): string;
  createAndCollect: string;
  createTitle: string;
  albumName: string;
  albumNamePlaceholder: string;
  cancel: string;
  create: string;
}

interface Props {
  count: number;
  albums: MaterialAlbumDto[];
  terms: TermListItem[];
  containsText: boolean;
  busy: boolean;
  labels: Labels;
  onAdd(albumIds: string[], termIds: string[]): Promise<void>;
  onCreateAndCollect(title: string): Promise<void>;
  onClear(): void;
}

const albumPrefix = 'album:';
const termPrefix = 'term:';

export function MaterialBatchToolbar({
  count,
  albums,
  terms,
  containsText,
  busy,
  labels,
  onAdd,
  onCreateAndCollect,
  onClear,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [destinations, setDestinations] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = busy || submitting;

  useEffect(() => {
    if (!pickerOpen) {
      setDestinations(new Set());
      setQuery('');
      setError('');
    }
  }, [pickerOpen]);

  useEffect(() => {
    if (!createOpen) {
      setTitle('');
      setError('');
    }
  }, [createOpen]);

  const needle = query.trim().toLocaleLowerCase();
  const visibleAlbumRows = useMemo(() => {
    const tree = buildMaterialAlbumTree(albums);
    const rows = flattenMaterialAlbumTree(tree);
    if (!needle) return rows.slice(0, 80);
    const visibleIds = new Set<string>();
    for (const { album } of rows) {
      if (!album.title.toLocaleLowerCase().includes(needle)) continue;
      visibleIds.add(album.id);
      const visited = new Set<string>();
      let parentId = tree.parentById.get(album.id);
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        visibleIds.add(parentId);
        parentId = tree.parentById.get(parentId);
      }
    }
    return rows.filter(({ album }) => visibleIds.has(album.id)).slice(0, 80);
  }, [albums, needle]);
  const visibleTerms = useMemo(
    () =>
      terms
        .filter(
          (term) =>
            term.editorialState !== 'ARCHIVED' &&
            (!needle ||
              `${term.title} ${term.localizations.map((item) => item.title).join(' ')}`
                .toLocaleLowerCase()
                .includes(needle)),
        )
        .slice(0, 80),
    [needle, terms],
  );

  function toggle(key: string) {
    setDestinations((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function add() {
    if (pending || count === 0 || destinations.size === 0) return;
    const albumIds = [...destinations].flatMap((key) =>
      key.startsWith(albumPrefix) ? [key.slice(albumPrefix.length)] : [],
    );
    const termIds = [...destinations].flatMap((key) =>
      key.startsWith(termPrefix) ? [key.slice(termPrefix.length)] : [],
    );
    setError('');
    setSubmitting(true);
    try {
      await onAdd(albumIds, termIds);
      setPickerOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || pending || count === 0) return;
    setError('');
    setSubmitting(true);
    try {
      await onCreateAndCollect(nextTitle);
      setCreateOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        data-slot="material-batch-toolbar"
        data-selected-count={count}
        data-operation-state={pending ? 'pending' : 'idle'}
        role="toolbar"
        aria-label={labels.selected(count)}
        className="flex min-h-11 shrink-0 items-center gap-2 border-b border-selected-border bg-selected px-4 text-selected-foreground sm:px-6"
      >
        <span className="mr-auto text-sm font-medium tabular-nums">{labels.selected(count)}</span>
        <Button
          data-action="material-batch-add"
          type="button"
          size="sm"
          className="h-8"
          disabled={pending || count === 0}
          onClick={() => setPickerOpen(true)}
        >
          {pending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <ListPlusIcon className="size-3.5" />}
          {labels.addTo}
        </Button>
        <Button
          data-action="material-batch-clear"
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          disabled={pending}
          title={labels.clear}
          aria-label={labels.clear}
          onClick={onClear}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          data-dialog="material-batch-destinations"
          data-operation-state={pending ? 'pending' : 'idle'}
          className="max-w-xl gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>{labels.addTo}</DialogTitle>
          </DialogHeader>
          <div className="relative mx-5 mt-4">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-field="material-batch-destination-search"
              autoFocus
              value={query}
              className="pl-9"
              placeholder={labels.searchDestinations}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ScrollArea type="always" className="max-h-[min(28rem,60vh)] min-h-56">
            <div className="space-y-4 px-5 py-4">
              <section aria-labelledby="material-destination-albums">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 id="material-destination-albums" className="text-xs font-semibold text-muted-foreground">
                    {labels.albums}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setPickerOpen(false);
                      setCreateOpen(true);
                    }}
                  >
                    <PlusIcon className="size-3.5" />
                    {labels.createAndCollect}
                  </Button>
                </div>
                <div className="divide-y rounded-lg border bg-background">
                  {visibleAlbumRows.map(({ album, depth }) => {
                    const key = `${albumPrefix}${album.id}`;
                    const preview = album.previewAssets[0];
                    return (
                      <label
                        key={album.id}
                        data-destination-album-id={album.id}
                        className="flex min-w-0 cursor-pointer items-center gap-2.5 py-2.5 pr-3 text-sm hover:bg-hover focus-within:bg-hover"
                        style={{ paddingLeft: 12 + depth * 20 }}
                      >
                        <Checkbox
                          data-action="material-batch-destination-album"
                          checked={destinations.has(key)}
                          onCheckedChange={() => toggle(key)}
                        />
                        {depth > 0 && <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                        <MaterialAlbumPreview asset={preview} className="size-6 rounded-md" />
                        <span className="min-w-0 flex-1 truncate">{album.title}</span>
                      </label>
                    );
                  })}
                  {visibleAlbumRows.length === 0 && (
                    <div className="px-3 py-5 text-center text-xs text-muted-foreground">{labels.empty}</div>
                  )}
                </div>
              </section>

              <Separator />
              <section aria-labelledby="material-destination-terms">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 id="material-destination-terms" className="text-xs font-semibold text-muted-foreground">
                    {labels.dictionary}
                  </h3>
                  {containsText && <span className="text-[11px] text-muted-foreground">{labels.imageTermsOnly}</span>}
                </div>
                <div className="divide-y rounded-lg border bg-background">
                  {visibleTerms.map((term) => {
                    const key = `${termPrefix}${term.id}`;
                    return (
                      <label
                        key={term.id}
                        data-destination-term-id={term.id}
                        className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover focus-within:bg-hover has-[:disabled]:cursor-default has-[:disabled]:text-disabled-foreground"
                      >
                        <Checkbox
                          data-action="material-batch-destination-term"
                          disabled={containsText}
                          checked={destinations.has(key)}
                          onCheckedChange={() => toggle(key)}
                        />
                        <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{term.title}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {term.mediaPreview.totalCount}
                        </span>
                      </label>
                    );
                  })}
                  {visibleTerms.length === 0 && (
                    <div className="px-3 py-5 text-center text-xs text-muted-foreground">{labels.emptyTerms}</div>
                  )}
                </div>
              </section>
            </div>
          </ScrollArea>
          {error && (
            <p role="alert" className="border-t px-5 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="border-t px-5 py-4">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setPickerOpen(false)}>
              {labels.cancel}
            </Button>
            <Button
              data-action="material-batch-confirm"
              type="button"
              disabled={pending || count === 0 || destinations.size === 0}
              onClick={() => void add()}
            >
              {pending && <LoaderCircleIcon className="size-4 animate-spin" />}
              {labels.addDestinationCount(destinations.size)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-dialog="material-batch-create-album" data-operation-state={pending ? 'pending' : 'idle'}>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>{labels.createTitle}</DialogTitle>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              {labels.albumName}
              <Input
                data-field="material-batch-album-name"
                autoFocus
                value={title}
                maxLength={120}
                disabled={pending}
                placeholder={labels.albumNamePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setCreateOpen(false)}>
                {labels.cancel}
              </Button>
              <Button
                data-action="material-batch-create-album"
                type="submit"
                disabled={pending || count === 0 || !title.trim()}
              >
                {pending && <LoaderCircleIcon className="size-4 animate-spin" />}
                {labels.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
