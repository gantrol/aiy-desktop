import type { GalleryViewMode } from '@/renderer/components/gallery/galleryPreferences';
import type { MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import type { MaterialStack } from '@/renderer/components/gallery/materialStacking';
import { MaterialMasonry } from '@/renderer/components/gallery/MaterialMasonry';
import { MaterialStackView } from '@/renderer/components/gallery/MaterialStackView';

interface Props {
  albumId: string;
  viewMode: GalleryViewMode;
  materials: readonly MaterialLibraryItem[];
  materialStacks: readonly MaterialStack[];
  busy: boolean;
  onOpen(item: MaterialLibraryItem): void;
  onOpenStack(stack: MaterialStack): void;
  onArchive(item: MaterialLibraryItem): void;
  onDelete(item: MaterialLibraryItem): void;
  notify(message: string): void;
}

export function CreatorAlbumMaterialViews({
  albumId,
  viewMode,
  materials,
  materialStacks,
  busy,
  onOpen,
  onOpenStack,
  onArchive,
  onDelete,
  notify,
}: Props) {
  if (viewMode === 'GRID') {
    return (
      <div data-material-view="GRID" className="w-full min-w-0 p-4 sm:p-6">
        <MaterialMasonry
          items={materials}
          selectedKey={null}
          checkedKeys={new Set()}
          selectionMode={false}
          selectionAvailable={false}
          onSelect={onOpen}
          onEnterSelection={() => undefined}
          onToggleSelection={() => undefined}
          onCopyText={() => undefined}
          onArchive={onArchive}
          onDelete={onDelete}
          lifecycleBusy={busy}
          notify={notify}
          revealContext={{ kind: 'ALBUM', albumId }}
        />
      </div>
    );
  }
  return (
    <div data-material-view="LIST" data-material-layout="STACK" className="w-full min-w-0 p-4 sm:p-6">
      <MaterialStackView
        stacks={materialStacks}
        selectedKey={null}
        selectionMode={false}
        selectionAvailable={false}
        onSelect={onOpen}
        onOpenStack={onOpenStack}
        onCopyText={() => undefined}
        onArchive={onArchive}
        onDelete={onDelete}
        lifecycleBusy={busy}
        notify={notify}
        revealContextForItem={() => ({ kind: 'ALBUM', albumId })}
      />
    </div>
  );
}
