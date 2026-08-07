import { FolderIcon, ImagesIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import {
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/renderer/components/ui/context-menu';

interface Props {
  albums: readonly AlbumDto[];
  currentAlbumLabel: string;
  emptyLabel: string;
  onSelect(album: AlbumDto): void;
}

interface AlbumCascadeMenuItemProps {
  album: AlbumDto;
  currentAlbumLabel: string;
  index: ReturnType<typeof buildAlbumTreeIndex>;
  onSelect(album: AlbumDto): void;
}

function AlbumCascadeMenuItem({ album, currentAlbumLabel, index, onSelect }: AlbumCascadeMenuItemProps) {
  const children = (index.childrenByParentId.get(album.id) ?? []).filter(
    (child) => !index.effectivelyArchived.has(child.id),
  );

  if (children.length === 0) {
    return (
      <ContextMenuItem title={album.title} onSelect={() => onSelect(album)}>
        <ContextMenuIcon className="text-muted-foreground">
          <ImagesIcon />
        </ContextMenuIcon>
        <span className="max-w-64 truncate">{album.title}</span>
      </ContextMenuItem>
    );
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger title={album.title}>
        <ContextMenuIcon className="text-muted-foreground">
          <FolderIcon />
        </ContextMenuIcon>
        <span className="max-w-64 truncate">{album.title}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 min-w-52 overflow-y-auto">
        <ContextMenuItem title={album.title} onSelect={() => onSelect(album)}>
          <ContextMenuIcon className="text-muted-foreground">
            <ImagesIcon />
          </ContextMenuIcon>
          {currentAlbumLabel}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {children.map((child) => (
          <AlbumCascadeMenuItem
            key={child.id}
            album={child}
            currentAlbumLabel={currentAlbumLabel}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function AlbumTreeContextMenuItems({ albums, currentAlbumLabel, emptyLabel, onSelect }: Props) {
  const index = useMemo(() => buildAlbumTreeIndex(albums), [albums]);

  if (index.activeRoots.length === 0) {
    return (
      <ContextMenuItem disabled>
        <ContextMenuIcon className="text-muted-foreground">
          <ImagesIcon />
        </ContextMenuIcon>
        {emptyLabel}
      </ContextMenuItem>
    );
  }

  return index.activeRoots.map((album) => (
    <AlbumCascadeMenuItem
      key={album.id}
      album={album}
      currentAlbumLabel={currentAlbumLabel}
      index={index}
      onSelect={onSelect}
    />
  ));
}
