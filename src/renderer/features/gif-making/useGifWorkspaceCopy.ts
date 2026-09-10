import { useRef, useState } from 'react';
import type { GifManifest } from '@/shared/contracts/gif-making';
import type { GifLaunchInput } from '@/renderer/features/gif-making/GifMakerProvider';
import type { useGifProject } from '@/renderer/features/gif-making/useGifProject';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type Project = ReturnType<typeof useGifProject>;

export function useGifWorkspaceCopy(options: {
  editor: Project;
  motion: Project;
  refresh(): Promise<boolean>;
  onOpen(input: GifLaunchInput): Promise<void>;
}) {
  const [copying, setCopying] = useState(false);
  const lock = useRef(false);
  const saveCopy = useStableCallback(async (manifest?: GifManifest) => {
    if (lock.current) return;
    lock.current = true;
    setCopying(true);
    const source = options.motion.capture();
    const content = options.editor.capture();
    try {
      const copy = await window.desktopApi.gifWorkspaceCreate({
        id: crypto.randomUUID(),
        motionId: crypto.randomUUID(),
        seriesId: content.seriesId,
        title: content.title,
        sourceDocumentId: content.id,
        motionManifest: source.manifest,
        motionDraft: source.motionDraft,
        manifest: manifest ?? content.manifest,
      });
      if (await options.refresh()) await options.onOpen({ documentId: copy.id });
    } finally {
      lock.current = false;
      setCopying(false);
    }
  });
  return { copying, saveCopy };
}
