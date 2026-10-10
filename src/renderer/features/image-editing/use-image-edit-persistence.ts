import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageEditSession } from '@/renderer/features/image-editing/image-edit-session';
import { exportImageEdit } from '@/renderer/features/image-editing/image-edit-export';
import type { ImageEditDocument } from '@/shared/contracts/image-edit';

export function useImageEditPersistence(
  session: ImageEditSession,
  image: HTMLImageElement,
  id: string,
  onClose: () => void | Promise<void>,
) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const [error, setError] = useState('');
  const operation = useRef<Promise<void> | null>(null),
    composing = useRef(false),
    closed = useRef(false);
  const completed = useRef<ImageEditDocument | null>(null);
  const returning = useRef(false);
  const persist = async () => {
    if (composing.current) throw new Error('IMAGE_EDIT_COMPOSING');
    const document = session.getSnapshot().document;
    if (completed.current !== document) {
      await session.checkpoint();
      if (session.isAdopted(document)) await session.cancel();
      else await session.commit(await exportImageEdit(image, document), document);
      completed.current = document;
    }
  };
  const actions = useRef({ persist });
  useEffect(() => {
    actions.current = { persist };
  });
  useEffect(
    () =>
      window.desktopPetals.onFlush(async (save) => {
        if (composing.current) return { status: 'blocked', reason: 'composing' };
        // The close handshake can itself request a flush. Its caller has already
        // committed or checkpointed, so waiting for that same operation would deadlock.
        if (returning.current) return { status: 'recoverable' };
        const unlock = session.lock();
        try {
          if (operation.current) await operation.current;
          if (closed.current) return { status: 'unchanged' };
          if (save) await actions.current.persist();
          else await session.checkpoint();
          return { status: save ? 'saved' : 'recoverable' };
        } catch {
          return { status: 'blocked', reason: 'persistence' };
        } finally {
          unlock();
        }
      }),
    [session],
  );
  const run = (action: () => Promise<void>) => {
    if (operation.current || composing.current || session.getSnapshot().locked) return;
    const unlock = session.lock();
    setError('');
    const pending = action();
    operation.current = pending;
    void pending
      .catch(() => setError(copy.failed))
      .finally(() => {
        if (operation.current === pending) operation.current = null;
        unlock();
      });
  };
  const close = async () => {
    returning.current = true;
    try {
      await onClose();
      closed.current = true;
    } finally {
      returning.current = false;
    }
  };
  const finish = (action: 'done' | 'copy' | 'convert') =>
    run(async () => {
      try {
        await persist();
      } catch {
        setError(copy.failed);
        return;
      }
      try {
        if (action === 'copy') await window.desktopPetals.assetFile({ assetId: session.resultAssetId, action: 'copy' });
        if (action === 'convert') await window.desktopPetals.temporaryFiles({ kind: 'convert', id });
        await close();
      } catch {
        setError(action === 'copy' ? copy.copyFailed : action === 'convert' ? copy.convertFailed : copy.failed);
      }
    });
  const cancel = () =>
    run(async () => {
      try {
        await session.cancel();
        await close();
      } catch {
        setError(copy.cancelFailed);
      }
    });
  const leave = () =>
    run(async () => {
      await session.checkpoint();
      await close();
    });
  return { error, setError, finish, cancel, leave, composing };
}
