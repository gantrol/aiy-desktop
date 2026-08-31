import type { Editor } from '@tiptap/core';
import type { ArticleEditorLocationDto } from '@/shared/contracts';
import {
  articleEditorLocationAtPosition,
  restoreArticleEditorLocation,
} from '@/renderer/features/video-documents/articleElementIdentity';

export function followInternalArticleHeadingLink(
  editor: Editor | null,
  root: HTMLElement | null,
  event: MouseEvent,
  onNavigate: ((location: ArticleEditorLocationDto) => void) | undefined,
) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const href = target.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href') ?? '';
  const headingId = /^#(article-heading-\d+)$/u.exec(href)?.[1];
  if (!headingId) return false;
  const heading = root?.querySelector<HTMLElement>(`[data-article-heading-id="${headingId}"]`);
  if (!heading || !editor || editor.isDestroyed) return false;
  const location = articleEditorLocationAtPosition(editor, editor.view.posAtDOM(heading, 0));
  if (!location) return false;
  event.preventDefault();
  onNavigate?.(location);
  restoreArticleEditorLocation(editor, location);
  return true;
}
