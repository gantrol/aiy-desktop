import { acquireSocialPostSaveSession } from '@/renderer/components/creator/SocialPostSaveSession';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { SocialPostDto } from '@/shared/contracts';
import type { SocialPostRevisionSaveInput, SocialPostRevisionSaveResult } from '@/shared/contracts/social-post';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

interface Options {
  spaceId: string;
  post: SocialPostDto;
  onSave(request: SocialPostRevisionSaveInput, spaceId?: string): Promise<SocialPostRevisionSaveResult>;
  notify(message: string): void;
}

export function useSocialPostSaveSession({ spaceId, post, onSave, notify }: Options) {
  const { messages } = useI18n();
  const copy = messages.creator.socialPostSave;
  const save = useStableCallback(onSave);
  const report = useStableCallback((kind: 'save' | 'recovery', detail?: string) =>
    notify(kind === 'save' ? copy.saveError.replace('{detail}', detail ?? '') : copy.recoveryError),
  );
  const postId = post.id;
  const session = useMemo(
    () => acquireSocialPostSaveSession({ spaceId, postId }, post, window.desktopApi, { save, report }),
    [spaceId, postId, post, save, report],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => session.updateHandlers({ save, report }), [session, save, report]);
  useEffect(() => session.receivePost(post), [session, post]);
  useEffect(() => {
    session.retain();
    const hidden = () => {
      if (document.visibilityState === 'hidden') void session.flushForExit();
    };
    const pageExit = () => {
      void session.flushForExit();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pageExit);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pageExit);
      session.release();
    };
  }, [session]);

  const missingIdsJson = JSON.stringify(
    state.content.mediaAssetIds.filter((id) => !state.mediaAssets.some((asset) => asset.id === id)),
  );
  const reportMedia = useStableCallback(() => notify(copy.missingMedia));
  useEffect(() => {
    if (!state.ready || missingIdsJson === '[]') return;
    const ids = JSON.parse(missingIdsJson) as string[];
    let current = true;
    void window.desktopApi
      .materialImageAssetsResolve({ targets: ids.map((imageAssetId) => ({ kind: 'IMAGE_ASSET', imageAssetId })) })
      .then((assets) => {
        if (!current) return;
        session.setMediaAssets((existing) => [
          ...new Map([...existing, ...assets].map((asset) => [asset.id, asset])).values(),
        ]);
        if (assets.length < ids.length) reportMedia();
      })
      .catch(() => {
        if (current) reportMedia();
      });
    return () => {
      current = false;
    };
  }, [missingIdsJson, state.ready, session, reportMedia]);

  return {
    ...state,
    setContent: session.setContent,
    setMediaAssets: session.setMediaAssets,
    trackInput: session.trackInput,
    setRecoverableInput: session.setRecoverableInput,
    persist: session.persist,
    retry: session.retry,
    resolveConflict: session.resolveConflict,
    resolveRecovery: session.resolveRecovery,
    savedPostRef: session.savedPostRef,
  };
}
