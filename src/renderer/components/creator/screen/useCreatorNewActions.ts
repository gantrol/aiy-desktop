import { useRef, useState } from 'react';
import type { CreationStartMode } from '@/shared/contracts/creation-draft';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

/** Shared creation entry points; each host supplies its own album context. */
export function useCreatorNewActions({ app, navigation }: CreatorScreenViewModel, albumId: string | null) {
  const animation = useGifMakerLauncher();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const start = useStableCallback(async (mode?: CreationStartMode | 'animation') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (mode === 'animation') {
        if (!animation || animation.busy || !animation.isCurrent()) return;
        if (!(await navigation.creation.preserveBeforeNavigation()) || !animation.isCurrent()) return;
        await animation.open({ forceNew: true, targetAlbumId: albumId });
      } else {
        await navigation.creation.startNewCreation(albumId, 'push', true, mode);
      }
    } catch (reason) {
      app.notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  });
  const onNewCreation = useStableCallback((mode?: CreationStartMode) => void start(mode));
  const onNewAnimation = useStableCallback(() => void start('animation'));
  return {
    busy,
    onNewCreation,
    onNewAnimation: animation && !animation.busy ? onNewAnimation : undefined,
  };
}
