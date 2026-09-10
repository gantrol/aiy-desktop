import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { NOTE_FILE_LIMITS } from '@/shared/contracts/note-files';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function usePetalFiles(
  session: NoteEditSession,
  prepare: () => Promise<boolean>,
  onError: (error: unknown) => void,
) {
  const pending = useRef<Promise<boolean> | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
    };
  }, []);
  const settle = useCallback(() => pending.current ?? Promise.resolve(true), []);
  const run = useStableCallback((action: () => Promise<void>) => {
    if (pending.current || session.getSnapshot().frozen) return Promise.resolve(false);
    cancelled.current = false;
    const operation = (async () => {
      try {
        if (!(await prepare()) || !(await session.flush()) || cancelled.current) return false;
        if (!session.setFrozen(true)) return false;
        await action();
        return true;
      } catch (error) {
        if (alive.current) onError(error);
        return false;
      } finally {
        pending.current = null;
        session.setFrozen(false);
        if (alive.current) setProgress(null);
      }
    })();
    pending.current = operation;
    return operation;
  });
  const importFiles = (files: File[]) =>
    run(async () => {
      if (!files.length) return;
      if (
        files.length + (session.getSnapshot().note.files?.length ?? 0) > NOTE_FILE_LIMITS.count ||
        files.some((file) => file.size > NOTE_FILE_LIMITS.fileBytes) ||
        files.reduce((sum, file) => sum + file.size, 0) > NOTE_FILE_LIMITS.batchBytes
      )
        throw new Error('[aiy-petal:fileLimit]');
      setProgress({ completed: 0, total: files.length });
      // Read and send one file at a time: at most 64 MiB of source bytes is in flight.
      for (const [index, file] of files.entries()) {
        if (cancelled.current) break;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (cancelled.current) break;
        const current = session.getSnapshot().note;
        session.receive(
          await window.desktopPetals.files({
            kind: 'import',
            id: current.id,
            expectedHash: current.contentHash,
            name: file.name,
            bytes,
          }),
        );
        if (alive.current) setProgress({ completed: index + 1, total: files.length });
      }
    });
  return {
    progress,
    settle,
    importFiles,
    cancel: () => {
      cancelled.current = true;
    },
    remove: (fileId: string) =>
      run(async () => {
        const current = session.getSnapshot().note;
        session.receive(
          await window.desktopPetals.files({
            kind: 'remove',
            id: current.id,
            expectedHash: current.contentHash,
            fileId,
          }),
        );
      }),
    open: (fileId: string) => {
      void window.desktopPetals.files({ kind: 'open', id: session.getSnapshot().note.id, fileId }).catch(onError);
    },
  };
}
