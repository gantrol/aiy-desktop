import { ArrowDownIcon, ArrowUpIcon, Settings2Icon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlbumCreationDefaultsDto,
  AlbumDto,
  Locale,
  PackCatalogItemDto,
  WordPaletteDto,
} from '@/shared/contracts';
import { normalizeAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import { ApplyWordPaletteDialog } from '@/renderer/components/palette/ApplyWordPaletteDialog';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

interface Props {
  album: AlbumDto | null;
  palettes: WordPaletteDto[];
  locale: Locale;
  onOpenChange(open: boolean): void;
  onSaved(album: AlbumDto): void | Promise<void>;
  notify(message: string): void;
}

function defaultsForAlbum(album: AlbumDto): AlbumCreationDefaultsDto {
  return normalizeAlbumCreationDefaults(album.creationDefaults);
}

export function AlbumCreationDefaultsDialog({ album, palettes, locale, onOpenChange, onSaved, notify }: Props) {
  const zh = locale === 'zh';
  const [defaults, setDefaults] = useState<AlbumCreationDefaultsDto | null>(null);
  const [catalog, setCatalog] = useState<PackCatalogItemDto[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paletteToConfigure, setPaletteToConfigure] = useState<WordPaletteDto | null>(null);
  const [editingPaletteId, setEditingPaletteId] = useState<string | null>(null);
  const baseline = useRef('');

  useEffect(() => {
    if (!album) return;
    const next = defaultsForAlbum(album);
    setDefaults(next);
    baseline.current = JSON.stringify(next);
    setError('');
    setLoadingPacks(true);
    void window.desktopApi
      .packsList()
      .then(setCatalog)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoadingPacks(false));
  }, [album?.id, album?.updatedAt]);

  const activePalettes = useMemo(() => palettes.filter((palette) => palette.status === 'ACTIVE'), [palettes]);
  const installedPacks = useMemo(
    () =>
      catalog.filter(
        (item) => item.installation?.state === 'INSTALLED' && Boolean(item.installation.selectedReleaseId),
      ),
    [catalog],
  );
  const editingReference = defaults?.recipes.find((reference) => reference.paletteId === editingPaletteId) ?? null;
  const dirty = Boolean(defaults && JSON.stringify(defaults) !== baseline.current);

  function requestOpenChange(open: boolean) {
    if (!open && dirty && !window.confirm(zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')) return;
    onOpenChange(open);
  }

  function configurePalette(palette: WordPaletteDto, editing: boolean) {
    setEditingPaletteId(editing ? palette.id : null);
    setPaletteToConfigure(palette);
  }

  function moveRecipe(index: number, offset: -1 | 1) {
    if (!defaults) return;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= defaults.recipes.length) return;
    const recipes = [...defaults.recipes];
    [recipes[index], recipes[nextIndex]] = [recipes[nextIndex], recipes[index]];
    setDefaults({ ...defaults, recipes });
  }

  function togglePack(item: PackCatalogItemDto, checked: boolean) {
    if (!defaults || !item.installation?.selectedReleaseId) return;
    const sources = checked
      ? [
          ...defaults.dictionaryScope.sources.filter((source) => source.packId !== item.pack.id),
          { packId: item.pack.id, packReleaseId: item.installation.selectedReleaseId },
        ]
      : defaults.dictionaryScope.sources.filter((source) => source.packId !== item.pack.id);
    setDefaults({ ...defaults, dictionaryScope: { ...defaults.dictionaryScope, sources } });
  }

  async function save() {
    if (!album || !defaults || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await window.desktopApi.albumsUpdateCreationDefaults({ albumId: album.id, defaults });
      baseline.current = JSON.stringify(defaults);
      await onSaved(updated);
      onOpenChange(false);
      notify(zh ? '图集默认值已保存' : 'Album defaults saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!album || !defaults) return null;
  const missingSources =
    defaults.dictionaryScope.mode === 'SELECTED'
      ? defaults.dictionaryScope.sources.filter(
          (source) =>
            !installedPacks.some(
              (item) => item.pack.id === source.packId && item.installation?.selectedReleaseId === source.packReleaseId,
            ),
        )
      : [];

  return (
    <>
      <Dialog open onOpenChange={requestOpenChange}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>
              {zh ? '图集设置' : 'Album settings'} · {album.title}
            </DialogTitle>
            <DialogDescription className="sr-only">{zh ? '新创作默认值' : 'New creation defaults'}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-6 overflow-y-auto px-6 py-1">
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label>{zh ? '默认配方' : 'Default recipes'}</Label>
                <Select
                  value=""
                  onValueChange={(paletteId) => {
                    const palette = activePalettes.find((item) => item.id === paletteId);
                    if (palette) configurePalette(palette, false);
                  }}
                >
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder={zh ? '添加配方' : 'Add recipe'} />
                  </SelectTrigger>
                  <SelectContent>
                    {activePalettes
                      .filter((palette) => !defaults.recipes.some((reference) => reference.paletteId === palette.id))
                      .map((palette) => (
                        <SelectItem key={palette.id} value={palette.id}>
                          {palette.name} · V{palette.revisionNo}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {defaults.recipes.length > 0 && (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {defaults.recipes.map((reference, index) => {
                    const palette = palettes.find((item) => item.id === reference.paletteId);
                    const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
                    return (
                      <div key={reference.paletteId} className="flex min-h-11 items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{palette?.name ?? reference.paletteId}</span>
                        <Badge
                          variant="outline"
                          className={!palette || !revision ? 'border-destructive text-destructive' : undefined}
                        >
                          {revision ? `V${revision.revisionNo}` : zh ? '不可用' : 'Unavailable'}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === 0}
                          aria-label={zh ? '上移' : 'Move up'}
                          onClick={() => moveRecipe(index, -1)}
                        >
                          <ArrowUpIcon className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === defaults.recipes.length - 1}
                          aria-label={zh ? '下移' : 'Move down'}
                          onClick={() => moveRecipe(index, 1)}
                        >
                          <ArrowDownIcon className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={!palette}
                          aria-label={zh ? '配置' : 'Configure'}
                          onClick={() => palette && configurePalette(palette, true)}
                        >
                          <Settings2Icon className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={zh ? '移除' : 'Remove'}
                          onClick={() =>
                            setDefaults({
                              ...defaults,
                              recipes: defaults.recipes.filter((item) => item.paletteId !== reference.paletteId),
                            })
                          }
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="grid gap-3 pb-5">
              <div className="flex items-center justify-between gap-3">
                <Label>{zh ? '默认词典' : 'Default dictionary'}</Label>
                <Segmented
                  type="single"
                  value={defaults.dictionaryScope.mode}
                  onValueChange={(value) =>
                    value &&
                    setDefaults({
                      ...defaults,
                      dictionaryScope: { ...defaults.dictionaryScope, mode: value as 'ALL' | 'SELECTED' },
                    })
                  }
                >
                  <SegmentedItem value="ALL">{zh ? '全部词典' : 'All'}</SegmentedItem>
                  <SegmentedItem value="SELECTED">{zh ? '指定词典' : 'Selected'}</SegmentedItem>
                </Segmented>
              </div>
              {defaults.dictionaryScope.mode === 'SELECTED' && (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {installedPacks.map((item) => {
                    const checked = defaults.dictionaryScope.sources.some(
                      (source) =>
                        source.packId === item.pack.id && source.packReleaseId === item.installation?.selectedReleaseId,
                    );
                    const release = item.releases.find(
                      (candidate) => candidate.id === item.installation?.selectedReleaseId,
                    );
                    return (
                      <label
                        key={item.pack.id}
                        className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                      >
                        <Checkbox checked={checked} onCheckedChange={(value) => togglePack(item, value === true)} />
                        <span className="min-w-0 flex-1 truncate">{item.pack.displayName}</span>
                        <span className="text-xs text-muted-foreground">{release?.version}</span>
                      </label>
                    );
                  })}
                  {missingSources.map((source) => (
                    <div
                      key={source.packId}
                      className="flex min-h-10 items-center gap-3 px-3 py-2 text-sm text-destructive"
                    >
                      <span className="min-w-0 flex-1 truncate">{source.packId}</span>
                      <span>{zh ? '不可用' : 'Unavailable'}</span>
                    </div>
                  ))}
                  {loadingPacks && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{zh ? '正在加载' : 'Loading'}</div>
                  )}
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 border-t px-3 py-2 text-sm">
                    <Checkbox
                      checked={defaults.dictionaryScope.includeLocalTerms}
                      onCheckedChange={(value) =>
                        setDefaults({
                          ...defaults,
                          dictionaryScope: { ...defaults.dictionaryScope, includeLocalTerms: value === true },
                        })
                      }
                    />
                    <span>{zh ? '本地词语和配方' : 'Local terms and recipes'}</span>
                  </label>
                </div>
              )}
            </section>
          </div>
          {error && (
            <p className="px-6 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => requestOpenChange(false)}>
              {zh ? '取消' : 'Cancel'}
            </Button>
            <Button type="button" disabled={busy || !dirty || missingSources.length > 0} onClick={() => void save()}>
              {zh ? '保存' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ApplyWordPaletteDialog
        locale={locale}
        defaultPromptLocale={locale}
        initialValues={editingReference?.parameterValues}
        initialPromptLocale={editingReference?.promptLocale}
        palette={paletteToConfigure}
        open={Boolean(paletteToConfigure)}
        onOpenChange={(open) => {
          if (!open) {
            setPaletteToConfigure(null);
            setEditingPaletteId(null);
          }
        }}
        onApply={(parameterValues, promptLocale) => {
          if (!paletteToConfigure) return;
          const reference = {
            paletteId: paletteToConfigure.id,
            paletteRevisionId: paletteToConfigure.revisionId,
            parameterValues,
            promptLocale,
          };
          const recipes = editingPaletteId
            ? defaults.recipes.map((item) => (item.paletteId === editingPaletteId ? reference : item))
            : [...defaults.recipes, reference];
          setDefaults({ ...defaults, recipes });
        }}
      />
    </>
  );
}
