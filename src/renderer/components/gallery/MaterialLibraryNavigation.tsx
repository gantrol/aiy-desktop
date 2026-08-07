import { ImagesIcon, PlusIcon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import type { GalleryDictionaryCollection } from '@/renderer/components/app/app-navigation';
import { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import { useDeferredSingleDoubleClick } from '@/renderer/components/albums/useDeferredSingleDoubleClick';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { DictionaryAlbumTree } from '@/renderer/components/gallery/DictionaryAlbumTree';
import type { DictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';
import {
  MaterialAlbumDialogs,
  type MaterialAlbumEditorState,
} from '@/renderer/components/gallery/MaterialAlbumDialogs';
import {
  CreationGroupBranch,
  MaterialAlbumBranch,
  type MaterialAlbumBranchLabels,
} from '@/renderer/components/gallery/MaterialAlbumTreeBranches';
import { buildMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';

export type MaterialLibraryCategory = 'DICTIONARY' | 'MATERIAL';

interface Labels extends MaterialAlbumBranchLabels {
  creation: string;
  dictionary: string;
  material: string;
  allMaterials: string;
  albums: string;
  create: string;
  createTitle: string;
  renameTitle: string;
  deleteTitle: string;
  deleteDescription(title: string): string;
  more: string;
  name: string;
  namePlaceholder: string;
  cancel: string;
  save: string;
  confirmDelete: string;
  operationFailed: string;
  move: string;
  moveTitle: string;
}

interface Props {
  albums: MaterialAlbumDto[];
  category: MaterialLibraryCategory;
  activeAlbumId: string | null;
  dictionarySelection: GalleryDictionaryCollection | null;
  dictionaryTree: DictionaryMaterialTree;
  labels: Labels;
  busy?: boolean;
  onSelectCategory(category: MaterialLibraryCategory): void;
  onSelectAlbum(albumId: string): void;
  onSelectDictionary(collection: GalleryDictionaryCollection): void;
  onCreate(title: string, parentAlbumId: string | null): Promise<void>;
  onRename(album: MaterialAlbumDto, title: string): Promise<void>;
  onDelete(album: MaterialAlbumDto): Promise<void>;
  onMove?(albumId: string, parentAlbumId: string | null): Promise<void>;
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[]): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
}

export function MaterialLibraryNavigation({
  albums,
  category,
  activeAlbumId,
  dictionarySelection,
  dictionaryTree,
  labels,
  busy = false,
  onSelectCategory,
  onSelectAlbum,
  onSelectDictionary,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onCollectMaterials,
  onImportFiles,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const expansion = useAlbumTreeExpansion(viewportRef);
  const click = useDeferredSingleDoubleClick();
  const [editor, setEditor] = useState<MaterialAlbumEditorState | null>(null);
  const [deleteAlbum, setDeleteAlbum] = useState<MaterialAlbumDto | null>(null);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const creationAlbums = albums.filter((album) => album.systemKey?.startsWith('CREATION_'));
  const userAlbums = albums.filter((album) => album.kind === 'USER');
  const tree = useMemo(() => buildMaterialAlbumTree(userAlbums), [userAlbums]);
  const creationTree = useMemo(() => buildMaterialAlbumTree(creationAlbums), [creationAlbums]);

  function categoryRow(target: MaterialLibraryCategory, title: string, icon: ReactNode) {
    const selected = category === target && !activeAlbumId && target !== 'DICTIONARY';
    return (
      <Button
        type="button"
        data-action={target === 'MATERIAL' ? 'material-all' : 'material-all-dictionary'}
        variant={selected ? 'secondary' : 'ghost'}
        className="h-11 w-full justify-start gap-2 px-2 font-normal"
        onClick={() => onSelectCategory(target)}
      >
        {icon}
        <span className="truncate text-base font-medium">{title}</span>
      </Button>
    );
  }

  return (
    <aside data-slot="material-library-navigation" className="flex w-64 shrink-0 flex-col border-r bg-muted/25">
      <div className="border-b p-2">
        <Segmented
          type="single"
          value={category}
          className="grid h-auto grid-cols-2"
          aria-label={`${labels.material} / ${labels.dictionary}`}
          onValueChange={(value) => value && onSelectCategory(value as MaterialLibraryCategory)}
        >
          <SegmentedItem value="MATERIAL" className="min-w-0 px-2">
            {labels.material}
          </SegmentedItem>
          <SegmentedItem value="DICTIONARY" className="min-w-0 px-2">
            {labels.dictionary}
          </SegmentedItem>
        </Segmented>
      </div>
      <ScrollArea type="always" className="min-h-0 flex-1" viewportRef={viewportRef}>
        <div className="space-y-0.5 p-2">
          {category === 'MATERIAL' && (
            <>
              {categoryRow('MATERIAL', labels.allMaterials, <ImagesIcon className="size-4" />)}
              {creationTree.roots.map((album) => (
                <CreationGroupBranch
                  key={album.id}
                  album={album}
                  tree={creationTree}
                  activeAlbumId={activeAlbumId}
                  labels={labels}
                  expansion={expansion}
                  click={click}
                  onSelectAlbum={onSelectAlbum}
                />
              ))}
              <div
                data-slot="material-album-section-heading"
                className="mt-3 flex h-9 items-center gap-2 border-t px-2 pt-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                  {labels.albums}
                </span>
                <Button
                  type="button"
                  data-action="material-create-album"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  title={labels.create}
                  aria-label={labels.create}
                  onClick={() => setEditor({ mode: 'create', parent: null })}
                >
                  <PlusIcon className="size-4" />
                </Button>
              </div>
              {tree.roots.map((album) => (
                <MaterialAlbumBranch
                  key={album.id}
                  album={album}
                  tree={tree}
                  activeAlbumId={activeAlbumId}
                  labels={labels}
                  busy={busy}
                  dropAlbumId={dropAlbumId}
                  expansion={expansion}
                  click={click}
                  onSelectAlbum={onSelectAlbum}
                  onDropAlbumChange={setDropAlbumId}
                  onEditorChange={setEditor}
                  onDeleteAlbumChange={setDeleteAlbum}
                  onMove={onMove}
                  onCollectMaterials={onCollectMaterials}
                  onImportFiles={onImportFiles}
                />
              ))}
            </>
          )}
          {category === 'DICTIONARY' && (
            <DictionaryAlbumTree
              tree={dictionaryTree}
              selection={dictionarySelection}
              expansion={expansion}
              click={click}
              openLabel={labels.open}
              expandLabel={labels.expand}
              collapseLabel={labels.collapse}
              moreLabel={labels.more}
              moreActionsLabel={labels.moreActions}
              onSelect={onSelectDictionary}
            />
          )}
        </div>
      </ScrollArea>

      <MaterialAlbumDialogs
        editor={editor}
        deleteAlbum={deleteAlbum}
        labels={labels}
        busy={busy}
        onEditorChange={setEditor}
        onDeleteAlbumChange={setDeleteAlbum}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
      />
    </aside>
  );
}
