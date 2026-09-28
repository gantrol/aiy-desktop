import { useCallback, useEffect, useMemo, useRef } from 'react';
import { projectArticleStructure } from '@/shared/article-structure';
import { ARTICLE_STRUCTURE_PAGE_SIZE, type ArticleStructureNode } from '@/shared/contracts/article-structure';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { CreationItemProjection } from '@/renderer/components/creator/creationLibraryProjection';
import type { CreationOutlineView } from '@/renderer/features/creation-outline/useCreationOutlineView';

export interface OutlineArticleContent {
  articleId: string;
  version: string;
  nodes: ArticleStructureNode[];
  revisionId?: string;
  nextOffset: number | null;
  legacy: boolean;
  loading?: boolean;
  failed?: boolean;
  live?: boolean;
}

export function useOutlineArticleContent(
  spaceId: string,
  creations: readonly CreationItemProjection[],
  view: CreationOutlineView,
  active: boolean,
) {
  const sessions = useArticleEditorSessions();
  const { articleContent, setArticleContent } = view;
  const versions = useMemo(
    () =>
      new Map(
        creations.flatMap((item) =>
          item.orderedForms.flatMap((form) =>
            form.entityRef.kind === 'ARTICLE' ? [[form.entityRef.id, item.item.updatedAt] as const] : [],
          ),
        ),
      ),
    [creations],
  );
  const cache = useRef(articleContent);
  cache.current = articleContent;
  const context = useRef({ spaceId, active, versions });
  context.current = { spaceId, active, versions };
  const protectedArticleId = useRef<string | undefined>(undefined);
  protectedArticleId.current = creations
    .flatMap((item) => item.orderedForms)
    .find((form) => form.entityRef.kind === 'ARTICLE' && view.scopeKey?.startsWith('form:' + form.form.id + ':block:'))
    ?.entityRef.id;
  const queue = useRef(Promise.resolve());
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    const ownedRequests = pending.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      const abandoned = new Set(ownedRequests);
      setArticleContent((entries) => {
        const next = new Map(entries);
        for (const key of abandoned) if (next.get(key)?.loading) next.delete(key);
        return next.size === entries.size ? entries : next;
      });
    };
  }, [setArticleContent]);
  const update = useCallback(
    (key: string, value: OutlineArticleContent) => {
      setArticleContent((current) => {
        const next = new Map(current);
        next.delete(key);
        next.set(key, value);
        if (next.size > 32) {
          const protectedKey = context.current.spaceId + ':' + protectedArticleId.current;
          const oldest = [...next].find(([candidate]) => candidate !== protectedKey);
          if (oldest) next.delete(oldest[0]);
        }
        return next;
      });
    },
    [setArticleContent],
  );
  const live = useCallback(
    (articleId: string, count = ARTICLE_STRUCTURE_PAGE_SIZE) => {
      const runtime = sessions?.find(spaceId, articleId);
      if (!runtime || runtime.getRecoveryPending() || runtime.model.getSnapshot().editorPending) return null;
      const state = runtime.model.getSnapshot();
      const document = runtime.getDocumentProjection();
      const nodes = projectArticleStructure(document, state.draft.metadata.mediaBindings);
      return {
        articleId,
        version: versions.get(articleId) ?? '',
        revisionId: state.persisted.revisionId,
        nodes: nodes.slice(0, count),
        nextOffset: count < nodes.length ? count : null,
        legacy: !document,
        live: true,
      };
    },
    [sessions, spaceId, versions],
  );
  const requested = [...articleContent.keys()]
    .filter((key) => key.startsWith(spaceId + ':'))
    .sort()
    .join('|');
  useEffect(() => {
    if (!active || !sessions) return;
    let unsubscribe: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = new Set<string>();
    const refreshLive = () => {
      for (const [key, entry] of cache.current) {
        if (!key.startsWith(spaceId + ':') || !changed.has(entry.articleId)) continue;
        const next = live(entry.articleId, Math.max(entry.nodes.length, ARTICLE_STRUCTURE_PAGE_SIZE));
        if (next) update(key, next);
      }
      changed.clear();
    };
    const schedule = (articleId: string) => {
      changed.add(articleId);
      clearTimeout(timer);
      timer = setTimeout(refreshLive, 180);
    };
    const subscribe = () => {
      unsubscribe.forEach((stop) => stop());
      unsubscribe = [...cache.current].flatMap(([key, entry]) => {
        if (!key.startsWith(spaceId + ':')) return [];
        const runtime = sessions.find(spaceId, entry.articleId);
        if (!runtime) return [];
        const refresh = () => schedule(entry.articleId);
        refresh();
        return [runtime.model.subscribe(refresh), runtime.subscribeMarkdownProjection(refresh)];
      });
    };
    subscribe();
    const stopRegistry = sessions.subscribe(subscribe);
    return () => {
      stopRegistry();
      unsubscribe.forEach((stop) => stop());
      clearTimeout(timer);
    };
  }, [active, sessions, requested, spaceId, live, update]);
  function load(articleId: string, more = false) {
    if (!active) return;
    const key = spaceId + ':' + articleId;
    if (pending.current.has(key)) return;
    const previous = cache.current.get(key);
    const version = versions.get(articleId) ?? '';
    const valid = previous?.version === version && !previous.failed && !previous.loading ? previous : undefined;
    const retained = more ? valid : undefined;
    const count = more
      ? (retained?.nodes.length ?? 0) + ARTICLE_STRUCTURE_PAGE_SIZE
      : Math.max(previous?.nodes.length ?? 0, ARTICLE_STRUCTURE_PAGE_SIZE);
    if (sessions?.find(spaceId, articleId)?.model.getSnapshot().editorPending) return;
    const draft = live(articleId, count);
    if (draft) {
      update(key, draft);
      return;
    }
    if (valid && (!more || valid.nextOffset === null)) return;
    pending.current.add(key);
    update(key, {
      articleId,
      version,
      nodes: retained?.nodes ?? [],
      revisionId: retained?.revisionId,
      nextOffset: retained?.nextOffset ?? null,
      legacy: false,
      loading: true,
    });
    // Explicit expansions are serialized; global expand/search never schedule full-library body reads.
    queue.current = queue.current.then(async () => {
      const current = () =>
        mounted.current && context.current.spaceId === spaceId && context.current.versions.get(articleId) === version;
      try {
        if (!current() || !context.current.active) return;
        const page = await contentLibraryApi().articleStructure({
          spaceId,
          articleId,
          offset: retained?.nextOffset ?? 0,
          expectedRevisionId: retained?.revisionId,
        });
        if (!current()) return;
        const latestDraft = live(articleId, count);
        update(
          key,
          latestDraft ?? {
            articleId,
            version,
            revisionId: page.revisionId,
            nodes: [...(retained?.nodes ?? []), ...page.nodes],
            nextOffset: page.nextOffset,
            legacy: page.legacy,
          },
        );
      } catch {
        if (current()) update(key, { articleId, version, nodes: [], nextOffset: null, legacy: false, failed: true });
      } finally {
        pending.current.delete(key);
        if (mounted.current)
          setArticleContent((entries) => {
            const entry = entries.get(key);
            if (!entry?.loading || entry.version !== version) return entries;
            const next = new Map(entries);
            next.delete(key);
            return next;
          });
      }
    });
  }
  const entries = useMemo(
    () =>
      new Map(
        [...articleContent].flatMap(([key, entry]) =>
          key.startsWith(spaceId + ':') &&
          versions.has(entry.articleId) &&
          (entry.version === versions.get(entry.articleId) || (entry.live && sessions?.find(spaceId, entry.articleId)))
            ? [[entry.articleId, entry] as const]
            : [],
        ),
      ),
    [articleContent, spaceId, versions, sessions],
  );
  return { entries, load };
}
