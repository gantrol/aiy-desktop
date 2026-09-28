import { useState } from 'react';
import type { ArticleDocumentWidth } from '@/renderer/lib/articleTypography';

const storageKey = 'aiy.social-post-editor.document-width.v1';

function readWidth(): ArticleDocumentWidth {
  try {
    return window.localStorage.getItem(storageKey) === 'WIDE' ? 'WIDE' : 'STANDARD';
  } catch {
    return 'STANDARD';
  }
}

/** Display preference only: changing width never updates the content or its save session. */
export function useSocialPostDocumentWidth() {
  const [width, setWidth] = useState(readWidth);
  function changeWidth(next: ArticleDocumentWidth) {
    setWidth(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Keep the view usable when renderer storage is unavailable.
    }
  }
  return { width, changeWidth };
}
