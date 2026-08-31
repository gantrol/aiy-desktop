import { useEffect, useRef } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

function articleCommentIdAtTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-article-comment-id]')?.dataset.articleCommentId ?? null;
}

function articleCommentElements(root: HTMLElement, commentId: string) {
  return root.querySelectorAll<HTMLElement>(`[data-article-comment-id="${CSS.escape(commentId)}"]`);
}

function resetArticleCommentElement(element: HTMLElement) {
  const open = element.dataset.articleCommentStatus === 'OPEN';
  delete element.dataset.articleCommentInteraction;
  element.style.setProperty('--article-comment-background', 'transparent');
  element.style.setProperty(
    '--article-comment-decoration',
    open ? 'color-mix(in srgb, var(--warning) 70%, transparent)' : 'transparent',
  );
  element.style.setProperty('--article-comment-thickness', '1px');
}

function projectArticleCommentInteraction(root: HTMLElement, commentId: string, interaction: 'selected' | 'hovered') {
  articleCommentElements(root, commentId).forEach((element) => {
    if (interaction === 'selected') {
      element.dataset.articleCommentInteraction = 'selected';
      element.style.setProperty(
        '--article-comment-background',
        'color-mix(in srgb, var(--warning-surface) 82%, transparent)',
      );
      element.style.setProperty('--article-comment-decoration', 'var(--warning)');
      element.style.setProperty('--article-comment-thickness', '2px');
      return;
    }
    element.dataset.articleCommentInteraction = 'hovered';
    element.style.setProperty(
      '--article-comment-background',
      'color-mix(in srgb, var(--warning-surface) 55%, transparent)',
    );
    element.style.setProperty('--article-comment-decoration', 'var(--warning)');
    element.style.setProperty('--article-comment-thickness', '2px');
  });
}

function resetArticleCommentInteraction(root: HTMLElement, commentId: string | null) {
  if (commentId) articleCommentElements(root, commentId).forEach(resetArticleCommentElement);
}

export function useArticleCommentDomInteractions(
  root: { current: HTMLElement | null },
  controls:
    | {
        comments: readonly { id: string }[];
        hoveredCommentId: string | null;
        selectedCommentId: string | null;
        onCommentHover(commentId: string | null): void;
        onCommentSelect(commentId: string): void;
      }
    | undefined,
  ready: boolean,
) {
  const hover = useStableCallback((commentId: string | null) => controls?.onCommentHover(commentId));
  const select = useStableCallback((commentId: string) => controls?.onCommentSelect(commentId));
  const hoverCloseTimerRef = useRef<number | null>(null);
  const projectedRef = useRef<{ hoveredId: string | null; selectedId: string | null }>({
    hoveredId: null,
    selectedId: null,
  });
  const enabled = ready && Boolean(controls);
  const comments = controls?.comments;
  const hoveredId = controls?.hoveredCommentId ?? null;
  const selectedId = controls?.selectedCommentId ?? null;

  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const next = ready ? { selectedId, hoveredId } : { selectedId: null, hoveredId: null };
    const frame = window.requestAnimationFrame(() => {
      const previous = projectedRef.current;
      const nextIds = new Set([next.selectedId, next.hoveredId].filter((id): id is string => Boolean(id)));
      if (previous.selectedId && !nextIds.has(previous.selectedId)) {
        resetArticleCommentInteraction(element, previous.selectedId);
      }
      if (previous.hoveredId && !nextIds.has(previous.hoveredId)) {
        resetArticleCommentInteraction(element, previous.hoveredId);
      }
      if (next.hoveredId) projectArticleCommentInteraction(element, next.hoveredId, 'hovered');
      if (next.selectedId) projectArticleCommentInteraction(element, next.selectedId, 'selected');
      projectedRef.current = next;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [comments, hoveredId, ready, root, selectedId]);

  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return undefined;

    function handleMouseOver(event: MouseEvent) {
      const commentId = articleCommentIdAtTarget(event.target);
      if (!commentId) return;
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
      if (commentId === articleCommentIdAtTarget(event.relatedTarget)) return;
      hover(commentId);
    }

    function handleMouseOut(event: MouseEvent) {
      const commentId = articleCommentIdAtTarget(event.target);
      if (!commentId) return;
      const nextCommentId = articleCommentIdAtTarget(event.relatedTarget);
      if (nextCommentId === commentId) return;
      hoverCloseTimerRef.current = window.setTimeout(() => {
        hoverCloseTimerRef.current = null;
        hover(nextCommentId);
      }, 140);
    }

    function handleClick(event: MouseEvent) {
      const commentId = articleCommentIdAtTarget(event.target);
      if (commentId) select(commentId);
    }

    element.addEventListener('mouseover', handleMouseOver);
    element.addEventListener('mouseout', handleMouseOut);
    element.addEventListener('click', handleClick);
    return () => {
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
      element.removeEventListener('mouseover', handleMouseOver);
      element.removeEventListener('mouseout', handleMouseOut);
      element.removeEventListener('click', handleClick);
    };
  }, [enabled, hover, root, select]);
}
