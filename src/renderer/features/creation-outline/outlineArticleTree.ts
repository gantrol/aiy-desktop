import type { MessageCatalog } from '@/renderer/i18n/types';
import type { OutlineArticleContent } from '@/renderer/features/creation-outline/useOutlineArticleContent';
import type { OutlineNode, OutlineTree } from '@/renderer/features/creation-outline/outline-tree';

export const outlineBlockKey = (formKey: string, blockId: string) => `${formKey}:block:${blockId}`;

export function withArticleStructure(
  tree: OutlineTree,
  entries: ReadonlyMap<string, OutlineArticleContent>,
  labels: MessageCatalog['creator']['outline'],
): OutlineTree {
  const nodes = new Map(tree.nodes);
  for (const original of tree.nodes.values()) {
    if (original.kind !== 'form' || original.form?.entityRef.kind !== 'ARTICLE') continue;
    const articleId = original.form.entityRef.id;
    const entry = entries.get(articleId);
    const form: OutlineNode = { ...original, articleId, children: [...original.children] };
    nodes.set(form.key, form);
    for (const block of entry?.nodes ?? []) {
      const key = outlineBlockKey(form.key, block.blockId);
      const parent = block.parentBlockId ? outlineBlockKey(form.key, block.parentBlockId) : form.key;
      const row: OutlineNode = {
        key,
        parent,
        children: [],
        kind: 'block',
        title: block.title || labels.contentKinds[block.kind],
        label: labels.contentKinds[block.kind],
        previewAssetId: block.assetId,
        content: { articleId, blockId: block.blockId, referenceId: block.referenceId, kind: block.kind },
      };
      nodes.set(key, row);
      (nodes.get(parent) ?? form).children.push(key);
    }
    if (!entry || entry.loading || entry.failed || entry.nextOffset !== null || !entry.nodes.length) {
      const key = form.key + ':content-status';
      const title = !entry
        ? labels.loadContent
        : entry.loading
          ? labels.loading
          : entry.failed
            ? labels.contentFailed
            : entry.nextOffset !== null
              ? labels.moreContent
              : entry.legacy
                ? labels.openContent
                : labels.emptyContent;
      nodes.set(key, {
        key,
        title,
        label: labels.contentStructure,
        parent: form.key,
        children: [],
        kind: 'content-action',
        form: original.form,
        contentAction: {
          articleId,
          action: entry && !entry.failed && !entry.loading ? (entry.nextOffset !== null ? 'MORE' : 'OPEN') : 'LOAD',
        },
      });
      form.children.push(key);
    }
  }
  return { nodes, roots: tree.roots };
}
