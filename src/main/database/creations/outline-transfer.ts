import { ulid } from 'ulid';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { OutlineTransferInput } from '@/shared/contracts/outline-transfer';
import { blockDocumentSchema, type BlockDocument, type BlockNode } from '@/shared/contracts/block-document';
import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import {
  deleteOutlineStructure,
  insertOutlineStructure,
  outlineItemRecords,
  outlineSelectionRoots,
} from '@/shared/outline-move';
import { contentAssetPath } from '@/shared/content-document';
import { blockDocumentPlacements } from '@/shared/block-document-placements';

type MediaBinding = { assetId: string; path: string };

/** Reuse destination bindings where possible and keep every copied image path aligned with its binding. */
export function transferredDocumentMedia(
  document: BlockDocument,
  sourceBindings: readonly MediaBinding[],
  targetBindings: readonly MediaBinding[],
) {
  const mediaBindings = targetBindings.map((binding) => ({ ...binding }));
  const bindingFor = (assetId: string, sourcePath: string | null) => {
    const exact = sourcePath
      ? mediaBindings.find((binding) => binding.assetId === assetId && binding.path === sourcePath)
      : null;
    const existing = exact ?? mediaBindings.find((binding) => binding.assetId === assetId);
    if (existing) return existing.path;
    const source =
      (sourcePath
        ? sourceBindings.find((binding) => binding.assetId === assetId && binding.path === sourcePath)
        : null) ?? sourceBindings.find((binding) => binding.assetId === assetId);
    let path = source?.path ?? contentAssetPath(assetId);
    while (mediaBindings.some((binding) => binding.path === path)) path = contentAssetPath(ulid());
    mediaBindings.push({ assetId, path });
    return path;
  };
  const visit = (node: BlockNode): BlockNode => {
    const assetId = node.type === 'image' && typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : null;
    const sourcePath = assetId && typeof node.attrs?.mediaPath === 'string' ? node.attrs.mediaPath : null;
    return {
      ...node,
      ...(assetId ? { attrs: { ...node.attrs, mediaPath: bindingFor(assetId, sourcePath) } } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  return {
    document: blockDocumentSchema.parse({ ...document, root: visit(document.root) }),
    mediaBindings,
  };
}

/** Both revisions change together, using the same revision writer as editor saves. */
export function transferOutlineItems(repositories: LibraryDatabaseRepositories, input: OutlineTransferInput) {
  return repositories.db
    .transaction(() => {
      const { articles, creationItems, albums } = repositories;
      if (input.sourceArticleId === input.targetArticleId) throw new Error('REFERENCE_TARGET_CHANGED');
      const source = articles.get(input.sourceArticleId);
      const target = articles.get(input.targetArticleId);
      const { mediaAssets: _sourceMedia, ...sourceContent } = source.content;
      const { mediaAssets: _targetMedia, ...targetContent } = target.content;
      for (const article of [source, target]) {
        const item = creationItems.findForEntity({ kind: 'ARTICLE', id: article.id });
        if (!item || item.lifecycle !== 'ACTIVE' || article.status !== 'ACTIVE')
          throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
        if (item.albumId) albums.assertAlbumAcceptsContent(item.albumId);
      }
      if (
        source.revisionId !== input.sourceRevisionId ||
        target.revisionId !== input.targetRevisionId ||
        !source.content.document ||
        !target.content.document
      )
        throw new Error('REFERENCE_TARGET_CHANGED');
      const records = outlineItemRecords(source.content.document.root);
      if (input.selectedIds.some((id) => !records.has(id))) throw new Error('REFERENCE_TARGET_CHANGED');
      const roots = outlineSelectionRoots(source.content.document.root, input.selectedIds);
      if (!roots.length) throw new Error('REFERENCE_TARGET_CHANGED');
      // Element identities have a document owner; even a cross-document move needs fresh destination identities.
      const selected = copyLinkedBlockDocument({
        type: 'doc',
        content: [{ type: 'bulletList', content: roots.map((id) => records.get(id)!.node) }],
      });
      const transferred = transferredDocumentMedia(
        selected,
        source.content.mediaBindings,
        target.content.mediaBindings,
      );
      const nextTarget = insertOutlineStructure(
        target.content.document.root,
        transferred.document.root.content![0].content!,
        input.targetId,
        input.placement,
      );
      const nextSource = input.copy
        ? source.content.document.root
        : deleteOutlineStructure(source.content.document.root, roots);
      if (!nextTarget || !nextSource) throw new Error('REFERENCE_TARGET_CHANGED');
      const targetDocument = blockDocumentSchema.parse({ ...target.content.document, root: nextTarget });
      const savedTarget = articles.saveSystemRevision({
        articleId: target.id,
        expectedRevisionId: target.revisionId,
        requestId: ulid(),
        content: { ...targetContent, document: targetDocument, mediaBindings: transferred.mediaBindings },
        elements: blockDocumentPlacements(targetDocument),
      });
      const savedSource = input.copy
        ? source
        : articles.saveSystemRevision({
            articleId: source.id,
            expectedRevisionId: source.revisionId,
            requestId: ulid(),
            content: {
              ...sourceContent,
              document: blockDocumentSchema.parse({ ...source.content.document, root: nextSource }),
            },
            elements: blockDocumentPlacements({ ...source.content.document, root: nextSource }),
          });
      return { source: savedSource, target: savedTarget };
    })
    .immediate();
}
