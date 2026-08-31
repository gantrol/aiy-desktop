import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoDocumentOutlineItem } from '@/renderer/features/video-documents/VideoDocumentOutlineRail';

export interface VideoDocumentArticleHeading extends VideoDocumentOutlineItem {
  line: number;
}

interface Options {
  markdown: string;
  draftHeadings: readonly VideoDocumentArticleHeading[];
  editing: boolean;
}

function outlineTitle(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

export function videoDocumentArticleHeadings(markdown: string): VideoDocumentArticleHeading[] {
  const headings: VideoDocumentArticleHeading[] = [];
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced) {
      const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
      const title = match ? outlineTitle(match[2]!) : '';
      if (match && title) {
        headings.push({
          id: `article-heading-${headings.length + 1}`,
          title,
          level: match[1]!.length,
          line: index + 1,
        });
      }
    }
  }
  return headings;
}

function headingLine(node: unknown) {
  if (!node || typeof node !== 'object') return null;
  const position = (node as { position?: { start?: { line?: unknown } } }).position;
  return typeof position?.start?.line === 'number' ? position.start.line : null;
}

function headingElement(article: HTMLElement, item: VideoDocumentOutlineItem, index: number) {
  return (
    article.querySelector<HTMLElement>(`[data-article-heading-id="${item.id}"]`) ??
    article.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6').item(index)
  );
}

function scrollToHeading(article: HTMLElement, element: HTMLElement) {
  const scrollRoot = article.closest<HTMLElement>('[data-slot="tabs-content"]');
  if (!scrollRoot) {
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    return;
  }
  const rootRect = scrollRoot.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const nextTop = Math.max(
    0,
    scrollRoot.scrollTop + elementRect.top - rootRect.top - (rootRect.height - elementRect.height) / 2,
  );
  scrollRoot.scrollTo({ top: nextTop, behavior: 'auto' });
}

export function useVideoDocumentArticleOutline({ markdown, draftHeadings, editing }: Options) {
  const articleRef = useRef<HTMLElement>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const renderedHeadings = useMemo(() => videoDocumentArticleHeadings(markdown), [markdown]);
  const outlineItems = editing ? draftHeadings : renderedHeadings;
  const headingByLine = useMemo(
    () => new Map(renderedHeadings.map((heading) => [heading.line, heading])),
    [renderedHeadings],
  );

  useEffect(() => {
    if (outlineItems.length === 0) {
      setActiveOutlineId(null);
      return undefined;
    }
    if (outlineItems.length > 0) {
      setActiveOutlineId((current) =>
        outlineItems.some((heading) => heading.id === current) ? current : (outlineItems[0]?.id ?? null),
      );
    }
    const article = articleRef.current;
    const scrollRoot = article?.closest<HTMLElement>('[data-slot="tabs-content"]') ?? article?.parentElement;
    if (!article || !scrollRoot) return undefined;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const threshold = scrollRoot.getBoundingClientRect().top + 96;
        let active = outlineItems[0]?.id ?? null;
        for (const [index, heading] of outlineItems.entries()) {
          const element = headingElement(article, heading, index);
          if (!element || element.getBoundingClientRect().top > threshold) break;
          active = heading.id;
        }
        setActiveOutlineId(active);
      });
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resizeObserver?.observe(article);
    scrollRoot.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      scrollRoot.removeEventListener('scroll', update);
    };
  }, [editing, outlineItems]);

  const headingIdForNode = useCallback(
    (node: unknown) => headingByLine.get(headingLine(node) ?? -1)?.id,
    [headingByLine],
  );

  const selectOutlineItem = useCallback(
    (item: VideoDocumentOutlineItem) => {
      setActiveOutlineId(item.id);
      const article = articleRef.current;
      if (!article) return;
      const index = outlineItems.findIndex((candidate) => candidate.id === item.id);
      if (index < 0) return;
      const element = headingElement(article, item, index);
      if (element) scrollToHeading(article, element);
    },
    [outlineItems],
  );

  return {
    articleRef,
    outlineItems,
    activeOutlineId,
    headingIdForNode,
    selectOutlineItem,
  };
}
