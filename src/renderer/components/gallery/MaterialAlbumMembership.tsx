import { CornerDownRightIcon, LoaderCircleIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MaterialAlbumDto, MaterialAlbumMemberDto } from '@/shared/contracts';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { buildMaterialAlbumTree, flattenMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';
import { MaterialAlbumPreview } from '@/renderer/components/gallery/MaterialAlbumPreview';

export interface MaterialAlbumMembershipTarget {
  materialId?: string | null;
  imageAssetId?: string | null;
  memberIds?: readonly string[];
}

export interface MaterialAlbumMembershipLabels {
  title: string;
  operationFailed: string;
}

export interface MaterialAlbumMembershipProps {
  albums: MaterialAlbumDto[];
  target: MaterialAlbumMembershipTarget;
  labels: MaterialAlbumMembershipLabels;
  disabled?: boolean;
  onToggle(album: MaterialAlbumDto, member: MaterialAlbumMemberDto | null, checked: boolean): Promise<void>;
}

function findMembership(album: MaterialAlbumDto, target: MaterialAlbumMembershipTarget) {
  const memberIds = new Set(target.memberIds ?? []);
  return (
    album.members.find(
      (member) =>
        memberIds.has(member.id) ||
        Boolean(target.materialId && member.materialId === target.materialId) ||
        Boolean(target.imageAssetId && member.imageAsset?.id === target.imageAssetId),
    ) ?? null
  );
}

export function MaterialAlbumMembership({
  albums,
  target,
  labels,
  disabled = false,
  onToggle,
}: MaterialAlbumMembershipProps) {
  const [pendingAlbumIds, setPendingAlbumIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const albumRows = useMemo(() => flattenMaterialAlbumTree(buildMaterialAlbumTree(albums)), [albums]);

  if (albumRows.length === 0) return null;

  async function toggle(album: MaterialAlbumDto, member: MaterialAlbumMemberDto | null, checked: boolean) {
    if (disabled || pendingAlbumIds.has(album.id)) return;
    setError('');
    setPendingAlbumIds((current) => new Set(current).add(album.id));
    try {
      await onToggle(album, member, checked);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : labels.operationFailed);
    } finally {
      setPendingAlbumIds((current) => {
        const next = new Set(current);
        next.delete(album.id);
        return next;
      });
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="material-album-membership-heading">
      <h3
        id="material-album-membership-heading"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {labels.title}
      </h3>
      <ScrollArea
        type="always"
        className="max-h-52 rounded-lg border bg-background [&_[data-slot=scroll-area-viewport]>div]:!block"
      >
        <div className="divide-y">
          {albumRows.map(({ album, depth }) => {
            const member = findMembership(album, target);
            const pending = pendingAlbumIds.has(album.id);
            const checked = Boolean(member);
            const preview = album.previewAssets[0];
            return (
              <label
                key={album.id}
                data-album-id={album.id}
                className="flex min-w-0 cursor-pointer items-center gap-2.5 py-2.5 pr-3 text-sm hover:bg-muted/60 focus-within:bg-muted/60"
                style={{ paddingLeft: 12 + depth * 20 }}
              >
                <Checkbox
                  data-action="material-album-membership"
                  checked={checked}
                  disabled={disabled || pending}
                  aria-label={album.title}
                  onCheckedChange={(value) => void toggle(album, member, value === true)}
                />
                {depth > 0 && <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                <MaterialAlbumPreview asset={preview} className="size-6 rounded-md" />
                <span className="min-w-0 flex-1 truncate" title={album.title}>
                  {album.title}
                </span>
                {pending && <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
              </label>
            );
          })}
        </div>
      </ScrollArea>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
