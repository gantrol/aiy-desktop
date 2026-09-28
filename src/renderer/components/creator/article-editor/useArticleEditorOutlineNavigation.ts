import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';

export interface ArticleEditorOutlineCursorRequest {
  index: number | null;
  revision: number;
}

interface Options {
  cursorRequest: ArticleEditorOutlineCursorRequest;
  followCursor: boolean;
  items: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
}

function editorHeadingElements(scrollRoot: HTMLElement, items: readonly VideoDocumentArticleHeading[]) {
  const editor = scrollRoot.querySelector<HTMLElement>('[data-slot="video-document-wysiwyg-editor"]');
  if (!editor) return [];
  const all = Array.from(editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
  const local = all.filter((element) => element.tagName !== 'H1' && !element.closest('[data-content-reference]'));
  const byId = new Map(
    all
      .filter((element) => element.dataset.articleHeadingId)
      .map((element) => [element.dataset.articleHeadingId!, element]),
  );
  let localIndex = 0;
  return items.map((item) => (item.id.startsWith('reference-') ? byId.get(item.id) : local[localIndex++]));
}

export function useArticleEditorOutlineNavigation({ cursorRequest, followCursor, items, scrollRootRef }: Options) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    setActiveId((current) => (items.some((item) => item.id === current) ? current : (items[0]?.id ?? null)));
  }, [items]);

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot || items.length === 0) return undefined;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rootRect = scrollRoot.getBoundingClientRect();
        const threshold = rootRect.top + rootRect.height / 2;
        const elements = editorHeadingElements(scrollRoot, items);
        let active = items[0]?.id ?? null;
        for (const [index, item] of items.entries()) {
          const element = elements[index];
          if (!element || element.getBoundingClientRect().top > threshold) break;
          active = item.id;
        }
        setActiveId(active);
      });
    };
    const editor = scrollRoot.querySelector<HTMLElement>('[data-slot="video-document-wysiwyg-editor"]');
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (editor) resizeObserver?.observe(editor);
    scrollRoot.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      scrollRoot.removeEventListener('scroll', update);
    };
  }, [items, scrollRootRef]);

  useEffect(() => {
    if (!followCursor) return;
    setActiveId(cursorRequest.index === null ? null : (items[cursorRequest.index]?.id ?? null));
  }, [cursorRequest.index, cursorRequest.revision, followCursor, items]);

  const selectItem = useCallback(
    (item: VideoDocumentArticleHeading, sourceIndex: number) => {
      setActiveId(item.id);
      const scrollRoot = scrollRootRef.current;
      if (!scrollRoot) return;
      const element = editorHeadingElements(scrollRoot, items)[sourceIndex];
      if (!element) return;
      const collapsed = element.closest('[data-reference-collapsed="true"]');
      const reveal = () => {
        if (!scrollRoot.isConnected || !scrollRoot.contains(element)) return;
        const rootRect = scrollRoot.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        scrollRoot.scrollTo({
          top: Math.max(
            0,
            scrollRoot.scrollTop + elementRect.top - rootRect.top - (rootRect.height - elementRect.height) / 2,
          ),
          behavior: 'auto',
        });
      };
      if (collapsed) {
        collapsed.querySelector<HTMLButtonElement>('button[data-reference-expand]')?.click();
        window.requestAnimationFrame(reveal);
      } else reveal();
    },
    [scrollRootRef, items],
  );

  const selectTop = useCallback(() => {
    setActiveId(null);
    scrollRootRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [scrollRootRef]);

  return { activeId, selectItem, selectTop };
}
