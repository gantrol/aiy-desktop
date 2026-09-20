import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { useI18n } from '@/renderer/i18n/useI18n';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { MaterialAlbumGrid } from '@/renderer/components/gallery/MaterialAlbumGrid';
import { CreationAlbumGrid } from '@/renderer/components/gallery/CreationAlbumGrid';
import { MaterialAlbumHeader } from '@/renderer/components/gallery/MaterialAlbumHeader';
import { AlbumDetailHeader } from '@/renderer/components/gallery/AlbumDetailHeader';
import { AlbumContents } from '@/renderer/components/creator/AlbumContents';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { MaterialAlbumMoveProvider } from '@/renderer/components/gallery/MaterialAlbumMoveProvider';
import { useMaterialLayoutPreferences } from '@/renderer/components/gallery/materialLayoutPreferences';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { demoAlbums, asCreationAlbum } from './album-fixtures';
import './style.css';

const params = new URLSearchParams(document.documentElement.dataset.labSearch ?? location.search);
const locale = params.get('locale') === 'en' ? 'en' : 'zh';
const english = locale === 'en';
document.documentElement.lang = english ? 'en' : 'zh-CN';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const albums = demoAlbums(english);
const creationAlbums = albums.map((album) => ({
  ...album,
  kind: 'SYSTEM' as const,
  systemKey: 'CREATION_GROUP' as const,
  sourceAlbumId: album.id,
}));
const entries = albums.map((album) => ({ kind: 'ALBUM' as const, album: asCreationAlbum(album) }));
const catalog = hydrateLanguageCatalog(english ? {} : zhMessages, enMessages);
const copy = catalog.designLab.albumReview;

function AlbumLab() {
  const [view, setView] = useState(params.get('view') ?? 'library');
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const { messages } = useI18n();
  const { preferences, updatePreferences } = useMaterialLayoutPreferences();
  const notify = (value: string) => setNotice(value);
  const onOpen = (id: string) => {
    setActive(id);
    notify(`open:${id}`);
  };
  const move = async (id: string, parent: string | null) => notify(`move:${id}:${parent}`);
  const selected = albums.find((album) => album.id === active) ?? albums[0];
  const galleryLabels = messages.gallery.albums;
  const navigationLabels = {
    ...galleryLabels,
    albums: galleryLabels.myAlbums,
    moreActions: (title: string) => `${galleryLabels.moreActions}: ${title}`,
    belongsTo: (title: string) => `${galleryLabels.belongsTo} ${title}`,
    deleteDescription: () => galleryLabels.deleteDescription,
    newCreation: messages.app.menu.newCreation,
  };
  return (
    <TooltipProvider>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-9">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-muted-foreground">AIY / DESIGN LAB</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </header>
        <nav className="mb-5 flex flex-wrap items-center gap-1">
          {(['library', 'creation', 'detail', 'list', 'tree'] as const).map((id) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? 'secondary' : 'ghost'}
              aria-pressed={view === id}
              onClick={() => {
                setActive(null);
                setView(id);
              }}
            >
              {copy[id]}
            </Button>
          ))}
          <div className="ml-auto flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={preferences.arrangement === 'ROWS'}
              onClick={() => updatePreferences({ arrangement: 'ROWS' })}
            >
              {copy.rows}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={preferences.arrangement === 'COLUMNS'}
              onClick={() => updatePreferences({ arrangement: 'COLUMNS' })}
            >
              {copy.columns}
            </Button>
            <Button size="sm" variant="ghost" aria-pressed={busy} onClick={() => setBusy(!busy)}>
              {copy.busy}
            </Button>
          </div>
        </nav>
        <MaterialAlbumMoveProvider albums={albums} busy={busy} onMove={move}>
          {active && (
            <Button className="mb-2" variant="ghost" onClick={() => setActive(null)}>
              {copy.back}
            </Button>
          )}
          {active || view === 'detail' || view === 'list' ? (
            <section className="flex h-[min(720px,80vh)] min-h-80 flex-col overflow-hidden rounded-lg border border-border bg-surface">
              {view === 'library' ? (
                <MaterialAlbumHeader
                  album={selected}
                  countLabel={galleryLabels.materials(selected.materialCount)}
                  busy={busy}
                  onOpenRoot={() => setActive(null)}
                  onArchive={(album) => notify(`archive:${album.id}`)}
                  onDelete={(album) => notify(`delete:${album.id}`)}
                  notify={notify}
                />
              ) : (
                <AlbumDetailHeader
                  album={asCreationAlbum(selected)}
                  parent={null}
                  labels={navigationLabels}
                  busy={busy}
                  onRename={async (_, title) => notify(`rename:${title}`)}
                  onTogglePin={async (album) => notify(`pin:${album.id}`)}
                  onArchive={async (album) => notify(`archive:${album.id}`)}
                  onDelete={async (album) => notify(`delete:${album.id}`)}
                  onCreateCreation={() => notify('create')}
                  notify={notify}
                />
              )}
              <AlbumContents
                entries={entries}
                layout={view === 'list' ? 'list' : 'grid'}
                busy={busy}
                loading={false}
                loadingMore={false}
                hasMore={false}
                onLoadMore={() => undefined}
                onSelectAlbum={onOpen}
                onOpenCreationForm={(form) => notify(`form:${form.key}`)}
                onSelectDocument={(id) => notify(`document:${id}`)}
                onOpenMaterial={(id) => notify(`material:${id}`)}
              />
            </section>
          ) : view === 'library' ? (
            <MaterialAlbumGrid
              title={copy.library}
              albums={albums.map((album) => ({
                album,
                materialCount: album.materialCount,
                directMaterialCount: album.materialCount,
                childAlbumCount: 0,
                previewAssets: album.previewAssets,
              }))}
              busy={busy}
              onOpen={onOpen}
              canMoveAlbum={(id, parent) => id !== parent}
              onMoveAlbum={move}
              onCollectMaterials={async (id) => notify(`collect:${id}`)}
              onImportFiles={(album) => notify(`import:${album.id}`)}
              onArchive={(album) => notify(`archive:${album.id}`)}
              onDelete={(album) => notify(`delete:${album.id}`)}
            />
          ) : view === 'creation' ? (
            <CreationAlbumGrid
              albums={creationAlbums}
              title={copy.creation}
              busy={busy}
              onOpen={onOpen}
              canMoveCreationAlbum={(id, parent) => id !== parent}
              onMoveCreationAlbum={move}
            />
          ) : (
            <section className="max-w-80 rounded-md border border-border bg-surface p-3">
              {albums.map((album) => (
                <Collapsible key={album.id} open={treeOpen} onOpenChange={setTreeOpen}>
                  <div className="flex min-w-0 items-center gap-2">
                    <AlbumTreePreview
                      assets={album.previewAssets}
                      title={album.title}
                      open={treeOpen}
                      expandable
                      expandLabel={galleryLabels.expand}
                      onClick={() => notify(`select:${album.id}`)}
                      onDoubleClick={() => onOpen(album.id)}
                      onGestureExpand={() => {
                        setTreeOpen(true);
                        notify('gesture-open');
                      }}
                    />
                    <span data-tree-title className="min-w-0 truncate text-sm">
                      {album.title}
                    </span>
                  </div>
                </Collapsible>
              ))}
            </section>
          )}
        </MaterialAlbumMoveProvider>
        <p role="status" data-lab-notice className="mt-4 min-h-5 break-words text-xs text-muted-foreground">
          {notice || copy.note}
        </p>
      </main>
    </TooltipProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nContext.Provider
    value={{
      locale,
      setLocale: () => undefined,
      messages: catalog,
      availableLocales: ['zh', 'en'],
    }}
  >
    <AlbumLab />
  </I18nContext.Provider>,
);
