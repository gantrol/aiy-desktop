import { useEffect, useRef, useState } from 'react';
import { appendEditorImage } from '@/renderer/components/creator/socialPostEditorImage';
import type { useSocialPostSaveSession } from '@/renderer/components/creator/useSocialPostSaveSession';
import { TextCoverDialog } from '@/renderer/features/text-covers/TextCoverDialog';
import { importVideoDocumentEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { socialPostMediaLimit } from '@/shared/contracts/social-post';

type SaveSession = ReturnType<typeof useSocialPostSaveSession>;

export function useSocialPostTextCover(session: SaveSession, seed: string) {
  const [editing, setEditing] = useState<{ title: string; epoch: number; seed: string; cover: string | null } | null>(
    null,
  );
  const latest = useRef(session);
  latest.current = session;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function importCover(file: File) {
    if (!editing) return;
    const current = latest.current;
    const image = await importVideoDocumentEditorImage(file, 'UPLOAD');
    const next = latest.current;
    if (
      !mounted.current ||
      !next.ready ||
      next.setContent !== current.setContent ||
      next.editorEpoch !== editing.epoch ||
      next.content.coverAssetId !== editing.cover
    )
      throw new Error('COVER_CHANGED');
    appendEditorImage(
      image,
      (update) =>
        next.setContent((content) => {
          // Check against the save model inside its synchronous update, not a potentially stale React snapshot.
          if (content.coverAssetId !== editing.cover) throw new Error('COVER_CHANGED');
          const updated = typeof update === 'function' ? update(content) : update;
          return { ...updated, coverAssetId: image.media.assetId };
        }),
      next.setMediaAssets,
    );
  }
  const visible = editing && editing.seed === seed && editing.epoch === session.editorEpoch && session.ready;
  return {
    disabled: !session.ready || session.content.mediaAssetIds.length >= socialPostMediaLimit,
    open: () =>
      setEditing({
        title: session.content.title,
        epoch: session.editorEpoch,
        seed,
        cover: session.content.coverAssetId,
      }),
    dialog: visible ? (
      <TextCoverDialog
        title={editing.title}
        seed={seed}
        initialRatio="3:4"
        onApply={(file) => session.trackInput(importCover(file))}
        onClose={() => setEditing(null)}
      />
    ) : null,
  };
}
