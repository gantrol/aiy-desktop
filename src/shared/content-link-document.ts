import type { BlockNode } from '@/shared/contracts/block-document';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';
import type { ContentLinkInput } from '@/shared/contracts/content-links';

/** Read real navigation marks. Snapshots and matching text do not create backlinks. */
export function contentLinkUseSites(root: BlockNode, target: ContentLinkInput, persisted = true) {
  const sites = new Map<string, { blockId: string | null; preview: string }>();
  const visit = (node: BlockNode, blockId: string | null, owner: BlockNode) => {
    const ownId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : blockId;
    const block = node.type === 'paragraph' || node.type === 'heading' ? node : owner;
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'link') continue;
      const command = parseAiyDeepLink(mark.attrs?.href);
      if (!command || !('spaceId' in command) || !('entityId' in command)) continue;
      if (
        command.spaceId !== target.spaceId ||
        command.entityId !== target.target.id ||
        command.target !== (target.target.kind === 'ARTICLE' ? 'article' : 'album') ||
        (target.target.blockId && command.blockId !== target.target.blockId)
      )
        continue;
      const identity = persisted ? ownId : null;
      const key = identity ?? JSON.stringify(block);
      const text = (value: BlockNode): string => value.text ?? (value.content ?? []).map(text).join('');
      sites.set(key, { blockId: identity, preview: text(block).slice(0, 280) });
    }
    if (node.type === 'contentReference') return;
    node.content?.forEach((child) => visit(child, ownId, block));
  };
  visit(root, null, root);
  return [...sites.values()];
}
