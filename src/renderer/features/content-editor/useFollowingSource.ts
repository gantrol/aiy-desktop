import { useEffect, useState } from 'react';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  createArticleEditorSessionRuntime,
  type ArticleEditorSessionRuntime,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import type { ContentReference, ReferenceOpenResult } from '@/shared/contracts/content-library';

const opening = new Map<string, Promise<ReferenceOpenResult>>();

/** Embedded editors lease the same save/recovery session used by the source's workspace tab. */
export function useFollowingSource(reference: ContentReference) {
  const registry = useArticleEditorSessions();
  const [runtime, setRuntime] = useState<ArticleEditorSessionRuntime>();
  const [failure, setFailure] = useState('');
  const [revision, setRevision] = useState(0);
  const spaceId = reference.spaceId;
  const articleId = reference.source.id;
  useEffect(() => {
    if (!registry || !spaceId || reference.source.kind !== 'ARTICLE') return;
    let cancelled = false;
    let release: (() => void) | undefined;
    const key = `${spaceId}:${articleId}`;
    const attach = (source: ArticleEditorSessionRuntime) => {
      if (cancelled) return;
      registry.retain(key, source);
      const changed = () => setRevision((value) => value + 1);
      const disconnect = [
        source.model.subscribe(changed),
        source.subscribeMarkdownProjection(changed),
        source.subscribeRecovery(changed),
      ];
      source.start();
      setRuntime(source);
      release = () => {
        disconnect.forEach((stop) => stop());
        registry.release(key, source);
      };
    };
    const existing = registry.find(spaceId, articleId);
    if (existing) attach(existing);
    else {
      let request = opening.get(key);
      if (!request) {
        request = contentLibraryApi().referenceOpen({ source: { kind: 'ARTICLE', id: articleId } });
        opening.set(key, request);
        void request
          .finally(() => {
            if (opening.get(key) === request) opening.delete(key);
          })
          .catch(() => undefined);
      }
      void request
        .then((result) => {
          if (cancelled) return;
          if (result.spaceId !== spaceId) throw new Error('REFERENCE_FOLLOW_SPACE_CHANGED');
          attach(
            registry.getOrCreate(key, () =>
              createArticleEditorSessionRuntime({
                article: result.article,
                spaceId,
                onSave: (input) => window.desktopApi.articleRevisionSave(input),
                onSaved: () => undefined,
                onConflict: () => undefined,
                onError: () => undefined,
                onRecoveryError: () => {
                  if (!cancelled) setFailure('REFERENCE_SAVE_FAILED');
                },
              }),
            ),
          );
        })
        .catch((reason: unknown) => {
          if (!cancelled) setFailure(String(reason));
        });
    }
    const transition = window.desktopApi?.onLocalSpaceTransition?.(() => {
      cancelled = true;
      setRuntime(undefined);
      release?.();
      release = undefined;
    });
    return () => {
      cancelled = true;
      transition?.();
      release?.();
    };
  }, [registry, spaceId, articleId, reference.source.kind]);
  useEffect(() => {
    if (!runtime || runtime.capturePersistedArticle().revisionId === reference.revisionId) return;
    let cancelled = false;
    void contentLibraryApi()
      .referenceOpen({ source: { kind: 'ARTICLE', id: articleId } })
      .then((result) => {
        if (!cancelled && result.spaceId === spaceId) runtime.receiveArticle(result.article);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setFailure(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, articleId, spaceId, reference.revisionId]);
  return { runtime, failure, revision };
}
