import { useEffect, useMemo, useRef } from 'react';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import type { TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import {
  CreationLibraryAlbumDraft,
  type CreationAlbumRequest,
} from '@/renderer/components/creator/CreationLibraryAlbumDraft';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  request: CreationAlbumRequest | null;
  tree: AlbumTreeIndex;
  busy: boolean;
  reveal(path: ReadonlySet<string>): void;
  onConfirm(request: CreationAlbumRequest, title: string): Promise<boolean>;
  onCancel(): void;
  notify(message: string): void;
}

export function useCreationAlbumDraft({ request, tree, busy, reveal, onConfirm, onCancel, notify }: Options) {
  const labels = useI18n().messages.creator.album;
  const revealed = useRef<string | null>(null);
  const revealDraft = useStableCallback(reveal);
  const cancelUnavailableParent = useStableCallback(() => {
    onCancel();
    notify(labels.albumParentUnavailable);
  });
  const path = useMemo(() => {
    const result = new Set<string>();
    let id = request?.parent?.id;
    while (id && !result.has(id)) {
      result.add(id);
      id = tree.parentById.get(id);
    }
    return result;
  }, [request, tree.parentById]);

  useEffect(() => {
    const parentId = request?.parent?.id;
    if (parentId && !busy && (!tree.byId.has(parentId) || tree.effectivelyArchived.has(parentId))) {
      cancelUnavailableParent();
    }
  }, [busy, cancelUnavailableParent, request, tree]);

  useEffect(() => {
    if (!request || revealed.current === request.id) return;
    revealed.current = request.id;
    revealDraft(path);
  }, [path, request, revealDraft]);

  function belongsTo(parentId: string | null) {
    return Boolean(request && (request.parent?.id ?? null) === parentId);
  }

  function renderAt(parentId: string | null, branchTopology?: TreeBranchItemTopology) {
    if (!request || !belongsTo(parentId)) return null;
    return (
      <CreationLibraryAlbumDraft
        key={request.id}
        request={request}
        siblings={parentId ? (tree.childrenByParentId.get(parentId) ?? []) : tree.activeRoots}
        branchTopology={branchTopology}
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

  return { path, belongsTo, renderAt };
}
