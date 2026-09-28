import { useEffect, useState, type RefObject } from 'react';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';

/** Merge read-only occurrences at their real positions; they never acquire writable host heading indices. */
export function articleHeadingsWithReferences(
  editor: HTMLElement,
  local: readonly VideoDocumentArticleHeading[],
): VideoDocumentArticleHeading[] {
  let localIndex = 0;
  const result: VideoDocumentArticleHeading[] = [];
  for (const element of editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (element.closest('[data-content-reference]')) {
      const id = element.dataset.articleHeadingId;
      if (id && element.dataset.referenceHeading !== undefined)
        result.push({ id, title: element.textContent?.trim() ?? '', level: Number(element.tagName.slice(1)), line: 0 });
    } else if (element.tagName !== 'H1') {
      const heading = local[localIndex++];
      if (heading) result.push(heading);
    }
  }
  // The editor may not yet have committed the same host document as the sidebar.
  return localIndex === local.length ? result : [...local];
}

export function useArticleReferenceHeadings(
  local: readonly VideoDocumentArticleHeading[],
  scrollRootRef: RefObject<HTMLDivElement | null>,
) {
  const [value, setValue] = useState<{ local: typeof local; items: typeof local }>({ local, items: local });
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editor = root.querySelector<HTMLElement>('[data-slot="video-document-wysiwyg-editor"]');
        const items = editor ? articleHeadingsWithReferences(editor, local) : local;
        setValue((previous) =>
          previous.local === local && JSON.stringify(previous.items) === JSON.stringify(items)
            ? previous
            : { local, items },
        );
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [local, scrollRootRef]);
  return value.local === local ? value.items : local;
}
