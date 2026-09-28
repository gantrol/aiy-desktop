import type { CreationTreeDrag } from '@/renderer/components/albums/albumDrag';
import { ImagesIcon, PlusIcon } from 'lucide-react';
import { itemDragScopeProps, acceptsItemTransfer, itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { useMemo, useRef, useState, type ReactNode, type DragEvent } from 'react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import type { GalleryDictionaryCollection } from '@/renderer/components/app/app-navigation';
import { hasMaterialAlbumDrag, readMaterialAlbumDrag } from '@/renderer/components/albums/albumDrag';
import {
  useTreeBranchExpansion,
  type TreeBranchDiagnosticSink,
} from '@/renderer/components/albums/useTreeBranchExpansion';
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
  CreationAlbumBranch,
  MaterialAlbumBranch,
  type MaterialAlbumBranchLabels,
} from '@/renderer/components/gallery/MaterialAlbumTreeBranches';
import { buildMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';
import { WorkbenchNavigationPane } from '@/renderer/components/workbench/WorkbenchNavigationPane';
import { cn } from '@/renderer/lib/utils';

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
  browseOnly?: boolean;
  category: MaterialLibraryCategory;
  activeAlbumId: string | null;
  dictionarySelection: GalleryDictionaryCollection | null;
  dictionaryTree: DictionaryMaterialTree;
  labels: Labels;
  busy?: boolean;
  diagnostics?: TreeBranchDiagnosticSink;
  onSelectCategory(category: MaterialLibraryCategory): void;
  onSelectAlbum(albumId: string): void;
  onSelectDictionary(collection: GalleryDictionaryCollection): void;
  onCreate(title: string, parentAlbumId: string | null): Promise<void>;
  onRename(album: MaterialAlbumDto, title: string): Promise<void>;
  onArchive(album: MaterialAlbumDto): Promise<void>;
  onDelete(album: MaterialAlbumDto): Promise<void>;
  onMove?(albumId: string, parentAlbumId: string | null, copy?: boolean): Promise<void>;
  canMoveCreationAlbum?(source: CreationTreeDrag, parentAlbumId: string | null, copy?: boolean): boolean;
  onMoveCreationAlbum?(source: CreationTreeDrag, parentAlbumId: string | null, copy?: boolean): Promise<void>;
  onCollectMaterials(albumId: string, targets: MaterialSelectionTargetInput[], sourceAlbumId?: string): Promise<void>;
  onImportFiles?(album: MaterialAlbumDto, files: File[]): void;
}

export function MaterialLibraryNavigation({
  albums,
  browseOnly = false,
  category,
  activeAlbumId,
  dictionarySelection,
  dictionaryTree,
  labels,
  busy = false,
  diagnostics,
  onSelectCategory: selectCategory,
  onSelectAlbum: selectAlbum,
  onSelectDictionary: selectDictionary,
  onCreate,
  onRename,
  onArchive,
  onDelete,
  onMove,
  canMoveCreationAlbum,
  onMoveCreationAlbum,
  onCollectMaterials,
  onImportFiles,
}: Props) {
  const [navigationRevision, setNavigationRevision] = useState(0);
  function onSelectCategory(value: MaterialLibraryCategory) {
    setNavigationRevision((revision) => revision + 1);
    selectCategory(value);
  }
  function onSelectAlbum(value: string) {
    setNavigationRevision((revision) => revision + 1);
    selectAlbum(value);
  }
  function onSelectDictionary(value: GalleryDictionaryCollection) {
    setNavigationRevision((revision) => revision + 1);
    selectDictionary(value);
  }
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialDictionaryExpansionIds = useMemo(() => {
    if (!dictionarySelection?.domainId || !dictionarySelection.typeId) return [];
    return [
      `dictionary-domain:${dictionarySelection.domainId}`,
      `dictionary-type:${dictionarySelection.domainId}:${dictionarySelection.typeId}`,
    ];
  }, [dictionarySelection?.domainId, dictionarySelection?.typeId]);
  const expansion = useTreeBranchExpansion(viewportRef, initialDictionaryExpansionIds, diagnostics);
  const click = useDeferredSingleDoubleClick(280, diagnostics);
  const [editor, setEditor] = useState<MaterialAlbumEditorState | null>(null);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const creationAlbums = albums.filter((album) => album.systemKey?.startsWith('CREATION_'));
  const userAlbums = albums.filter((album) => album.kind === 'USER');
  const tree = useMemo(() => buildMaterialAlbumTree(userAlbums), [userAlbums]);
  const creationTree = useMemo(() => buildMaterialAlbumTree(creationAlbums), [creationAlbums]);
  const createAlbumParent = activeAlbumId ? (tree.byId.get(activeAlbumId) ?? null) : null;
  const createAlbumLabel = createAlbumParent ? labels.createChild : labels.create;

  function rootAlbumDropSource(event: DragEvent) {
    if (!acceptsItemTransfer(event)) return null;
    const { dataTransfer } = event;
    if (browseOnly || busy || !onMove || !hasMaterialAlbumDrag(dataTransfer)) return null;
    const sourceAlbumId = readMaterialAlbumDrag(dataTransfer);
    const source = sourceAlbumId ? tree.byId.get(sourceAlbumId) : undefined;
    return source && (source.parentId || itemDragIntent(event) === 'COPY') ? source.id : null;
  }

  function categoryRow(target: MaterialLibraryCategory, title: string, icon: ReactNode) {
    const selected = category === target && !activeAlbumId && target !== 'DICTIONARY';
    return (
      <Button
        type="button"
        data-action={target === 'MATERIAL' ? 'material-all' : 'material-all-dictionary'}
        variant={selected ? 'secondary' : 'ghost'}
        className={cn(
          'h-11 w-full justify-start gap-2 px-2 font-normal',
          target === 'MATERIAL' && rootDropActive && 'ring-1 ring-inset ring-ring',
        )}
        onClick={() => onSelectCategory(target)}
        onDragEnter={(event) => {
          if (target !== 'MATERIAL' || !rootAlbumDropSource(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setRootDropActive(true);
        }}
        onDragOver={(event) => {
          if (target !== 'MATERIAL' || !rootAlbumDropSource(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = itemDragIntent(event) === 'COPY' ? 'copy' : 'move';
        }}
        onDragLeave={(event) => {
          if (target === 'MATERIAL' && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setRootDropActive(false);
          }
        }}
        onDrop={(event) => {
          if (target !== 'MATERIAL') return;
          const sourceAlbumId = rootAlbumDropSource(event);
          if (!sourceAlbumId) return;
          event.preventDefault();
          event.stopPropagation();
          setRootDropActive(false);
          void onMove?.(sourceAlbumId, null, itemDragIntent(event) === 'COPY').catch(() => undefined);
        }}
      >
        {icon}
        <span className="truncate text-base font-medium">{title}</span>
      </Button>
    );
  }

  return (
    <WorkbenchNavigationPane
      {...itemDragScopeProps}
      data-slot="material-library-navigation"
      layoutKey={browseOnly ? 'material-picker-navigation' : 'material-library-navigation'}
      label={labels.albums}
      selectionKey={JSON.stringify([navigationRevision, category, activeAlbumId, dictionarySelection])}
    >
      <div className="border-b p-2">
        <Segmented
          type="single"
          value={category}
          className="grid h-auto grid-cols-2"
          aria-label={`${labels.material} / ${labels.dictionary}`}
          onValueChange={(value) => value && onSelectCategory(value as MaterialLibraryCategory)}
        >
          <SegmentedItem data-action="material-tab-library" value="MATERIAL" className="min-w-0 px-2">
            {labels.material}
          </SegmentedItem>
          <SegmentedItem data-action="material-tab-dictionary" value="DICTIONARY" className="min-w-0 px-2">
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
                <CreationAlbumBranch
                  key={album.id}
                  album={album}
                  tree={creationTree}
                  activeAlbumId={activeAlbumId}
                  labels={labels}
                  busy={busy}
                  dropAlbumId={dropAlbumId}
                  expansion={expansion}
                  click={click}
                  onSelectAlbum={onSelectAlbum}
                  onDropAlbumChange={setDropAlbumId}
                  canMoveCreationAlbum={canMoveCreationAlbum}
                  onMoveCreationAlbum={onMoveCreationAlbum}
                />
              ))}
              <div
                data-slot="material-album-section-heading"
                className="mt-3 flex h-9 items-center gap-2 border-t px-2 pt-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                  {labels.albums}
                </span>
                {!browseOnly && (
                  <Button
                    type="button"
                    data-action="material-create-album"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    title={createAlbumLabel}
                    aria-label={createAlbumLabel}
                    onClick={() => setEditor({ mode: 'create', parent: createAlbumParent })}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                )}
              </div>
              {tree.roots.map((album) => (
                <MaterialAlbumBranch
                  key={album.id}
                  album={album}
                  tree={tree}
                  activeAlbumId={activeAlbumId}
                  labels={labels}
                  browseOnly={browseOnly}
                  busy={busy}
                  dropAlbumId={dropAlbumId}
                  expansion={expansion}
                  click={click}
                  onSelectAlbum={onSelectAlbum}
                  onDropAlbumChange={setDropAlbumId}
                  onEditorChange={setEditor}
                  onArchive={onArchive}
                  onDelete={onDelete}
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
              diagnostics={diagnostics}
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
      {!browseOnly && (
        <MaterialAlbumDialogs
          editor={editor}
          labels={labels}
          busy={busy}
          onEditorChange={setEditor}
          onCreate={onCreate}
          onRename={onRename}
        />
      )}
    </WorkbenchNavigationPane>
  );
}
