import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import { isDocumentSource } from '@/shared/contracts/content-source';
import type { OutlineNode } from '@/renderer/features/creation-outline/outline-tree';
import { useEffect, useRef } from 'react';

export function useOutlineContentNavigation(
  spaceId: string,
  active: boolean,
  onError: (message: string) => void,
  failure: string,
) {
  const navigate = useReferenceNavigation(undefined, active);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [spaceId, active],
  );
  async function open(node: OutlineNode, source = false) {
    if (!active || !node.content) return;
    const request = ++epoch.current;
    try {
      const { articleId, blockId, referenceId } = node.content;
      if (!source) await navigate({ source: { kind: 'ARTICLE', id: articleId }, blockId });
      else if (referenceId) {
        const [reference] = await contentLibraryApi().references([referenceId]);
        if (request !== epoch.current) return;
        if (!reference) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
        if (reference.source.kind === 'ALBUM') {
          if (!openAppContentLink(contentLinkUrl({ spaceId, target: { kind: 'ALBUM', id: reference.source.id } })))
            throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
        } else if (isDocumentSource(reference.source)) {
          const { revisionId: _revision, ...currentSource } = reference.source;
          await navigate({
            source: currentSource,
            ...(reference.selector?.kind === 'BLOCK' ? { blockId: reference.selector.blockId } : {}),
          });
        } else throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      }
    } catch {
      if (request === epoch.current) onError(failure);
    }
  }
  return open;
}
