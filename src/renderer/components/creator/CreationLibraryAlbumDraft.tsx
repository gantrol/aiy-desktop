import { FolderIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationTreeNodeFrame } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { afterBranchExpansion } from '@/renderer/components/creator/useCreationTreeScroll';
import {
  COMPACT_TREE_NODE_METRICS,
  TREE_CONNECTION_GEOMETRY,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';

export interface CreationAlbumRequest {
  id: string;
  parent: AlbumDto | null;
  destination: 'LIBRARY' | 'NEW_CREATION';
}

interface Props {
  request: CreationAlbumRequest;
  siblings: readonly AlbumDto[];
  branchTopology?: TreeBranchItemTopology;
  busy: boolean;
  onConfirm(request: CreationAlbumRequest, title: string): Promise<boolean>;
  onCancel(): void;
}

function availableName(siblings: readonly AlbumDto[], base: string) {
  const names = new Set(siblings.map((album) => album.title.trim().toLocaleLowerCase()));
  let title = base;
  let suffix = 2;
  while (names.has(title.toLocaleLowerCase())) title = `${base} ${suffix++}`;
  return title;
}

export function CreationLibraryAlbumDraft({ request, siblings, branchTopology, busy, onConfirm, onCancel }: Props) {
  const labels = useI18n().messages.creator.album;
  const [defaultTitle] = useState(() => availableName(siblings, labels.defaultAlbumName));
  const [title, setTitle] = useState(defaultTitle);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const phase = useRef<'editing' | 'saving' | 'finished'>('editing');
  const focused = useRef(false);

  useEffect(() => {
    // Reveal after both the launching menu and the tree's scroll restoration settle.
    const reveal = () => {
      const input = inputRef.current;
      if (!input?.getClientRects().length) return;
      if (!focused.current) {
        input.focus({ preventScroll: true });
        input.select();
      }
      input.scrollIntoView({ block: 'nearest' });
    };
    const viewport = inputRef.current?.closest<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    if (viewport) return afterBranchExpansion(viewport, reveal);
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, []);

  async function confirm() {
    if (busy || phase.current !== 'editing') return;
    phase.current = 'saving';
    setSaving(true);
    const name = title.trim() || defaultTitle;
    setTitle(name);
    const created = await onConfirm(request, name);
    phase.current = created ? 'finished' : 'editing';
    setSaving(false);
    if (!created) inputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      className="relative flex h-9 min-w-0 items-center gap-1 rounded-sm bg-selected px-1"
      data-creation-album-draft={request.id}
      data-item-drag-ignore
      aria-busy={saving || busy}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <CreationTreeNodeFrame
        bounds={COMPACT_TREE_NODE_METRICS.bounds}
        rowInsetY={0}
        rowHeight={TREE_CONNECTION_GEOMETRY.compactRowHeight}
        branchTopology={branchTopology}
        className="-ml-1 flex h-9 shrink-0 items-center"
        style={{ width: COMPACT_TREE_NODE_METRICS.width }}
      >
        <span className="mx-1 grid size-7 place-items-center text-muted-foreground">
          <FolderIcon className="size-4" aria-hidden="true" />
        </span>
      </CreationTreeNodeFrame>
      <Input
        ref={inputRef}
        value={title}
        aria-label={labels.albumName}
        readOnly={saving || busy}
        className="relative z-10 h-7 min-w-0 flex-1 rounded-sm bg-surface px-1 focus-visible:ring-1 focus-visible:ring-offset-0"
        onChange={(event) => setTitle(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          if (focused.current) void confirm();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void confirm();
          } else if (event.key === 'Escape' && !saving && !busy) {
            event.preventDefault();
            phase.current = 'finished';
            onCancel();
          }
        }}
      />
      {saving && <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
    </div>
  );
}
