import { useEffect, useRef, useState } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import type { ContentLinkInput } from '@/shared/contracts/content-links';
import { creationPrimaryFormRoleSchema } from '@/shared/contracts/creation-library';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { OutlineNode } from '@/renderer/features/creation-outline/outline-tree';

export function outlineNodeLinkTarget(node: OutlineNode): ContentLinkInput['target'] | null {
  if (node.kind === 'album' && node.target) return { kind: 'ALBUM', id: node.target.id };
  if (node.content) return { kind: 'ARTICLE', id: node.content.articleId, blockId: node.content.blockId };
  if (node.kind === 'form' && node.form?.entityRef.kind === 'ARTICLE')
    return { kind: 'ARTICLE', id: node.form.entityRef.id };
  return null;
}

export function canSetOutlinePrimary(node: OutlineNode) {
  return node.kind === 'form' && Boolean(node.form) && creationPrimaryFormRoleSchema.safeParse(node.form?.role).success;
}

export function useOutlineNodeActions({
  spaceId,
  active,
  busy,
  albums,
  refresh,
  notify,
  onError,
  onNew,
}: {
  spaceId: string;
  active: boolean;
  busy: boolean;
  albums: readonly AlbumDto[];
  refresh(): Promise<void>;
  notify(message: string): void;
  onError(message: string): void;
  onNew(albumId: string | null, isCurrent: () => boolean): Promise<unknown> | void;
}) {
  const { locale, messages } = useI18n();
  const labels = messages.creator.outline;
  const sessions = useArticleEditorSessions();
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const context = useRef({ epoch: 0, mounted: true });
  const [createParent, setCreateParent] = useState<AlbumDto | null | undefined>();
  const [renameAlbum, setRenameAlbum] = useState<AlbumDto | null>(null);
  useEffect(() => {
    const state = context.current;
    state.epoch++;
    state.mounted = true;
    return () => {
      state.epoch++;
      state.mounted = false;
    };
  }, [spaceId, active]);
  useEffect(() => {
    setCreateParent(undefined);
    setRenameAlbum(null);
  }, [spaceId]);

  async function perform(task: (current: () => boolean) => Promise<void>, report = true) {
    if (!active || busy || running.current) {
      if (!report) throw new Error(labels.errors.BUSY);
      return;
    }
    running.current = true;
    setPending(true);
    const request = context.current.epoch;
    const current = () => context.current.mounted && request === context.current.epoch;
    onError('');
    try {
      await task(current);
    } catch {
      if (current() && report) onError(labels.actionFailed);
      if (!report) throw new Error(labels.actionFailed);
    } finally {
      running.current = false;
      if (context.current.mounted) setPending(false);
    }
  }
  async function refreshSaved(current: () => boolean) {
    if (current())
      await refresh().catch(() => {
        if (current()) onError(labels.refreshFailed);
      });
  }
  return {
    pending,
    createParent,
    setCreateParent,
    renameAlbum,
    setRenameAlbum,
    newCreation: (albumId: string | null) =>
      void perform(async (current) => {
        await onNew(albumId, current);
      }),
    newAlbum: (node: OutlineNode | null) => {
      const parent = node?.kind === 'album' ? albums.find((album) => album.id === node.target?.id) : null;
      if (parent !== undefined) setCreateParent(parent);
    },
    rename: (node: OutlineNode) => setRenameAlbum(albums.find((album) => album.id === node.target?.id) ?? null),
    create: (title: string) =>
      perform(async (current) => {
        await window.desktopApi.albumsCreate({ title, titleLocale: locale, parentAlbumId: createParent?.id ?? null });
        await refreshSaved(current);
      }, false),
    saveName: (album: AlbumDto, title: string) =>
      perform(async (current) => {
        await window.desktopApi.albumsRename({ albumId: album.id, title, locale });
        await refreshSaved(current);
      }, false),
    togglePin: (node: OutlineNode) =>
      void perform(async (current) => {
        if (!node.target || !node.libraryEntry) return;
        const pinned = !node.libraryEntry.pinned;
        if (node.kind === 'album') await window.desktopApi.albumsSetPinned({ albumId: node.target.id, pinned });
        else await window.desktopApi.creationItemSetPinned({ creationItemId: node.target.id, pinned });
        await refreshSaved(current);
      }),
    setPrimary: (node: OutlineNode) =>
      void perform(async (current) => {
        if (!canSetOutlinePrimary(node) || !node.form || node.primary) return;
        await window.desktopApi.creationItemSetPrimary({
          creationItemId: node.form.form.creationItemId,
          formId: node.form.form.id,
        });
        await refreshSaved(current);
      }),
    copyLink: (node: OutlineNode) =>
      void perform(async (current) => {
        const target = outlineNodeLinkTarget(node);
        if (!target) return;
        const session = target.kind === 'ARTICLE' ? sessions?.find(spaceId, target.id) : undefined;
        if (session && (session.getRecoveryPending() || !(await session.flush('manual'))))
          throw new Error('SAVE_FAILED');
        if (!current()) return;
        const link = await contentLibraryApi().linkResolve({ spaceId, target });
        if (!current()) return;
        await navigator.clipboard.writeText(link.url);
        if (current()) notify(labels.linkCopied);
      }),
  };
}

export type OutlineNodeActions = ReturnType<typeof useOutlineNodeActions>;
