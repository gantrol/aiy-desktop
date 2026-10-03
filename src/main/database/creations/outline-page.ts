import { createHash } from 'node:crypto';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import { localArticleWriteContext } from '@/main/database/creations/article-write-context';
import { transferredDocumentMedia } from '@/main/database/creations/outline-transfer';
import { outlinePageCreateInputSchema, type OutlinePageCreateInput } from '@/shared/contracts/outline-page';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import { blockDocumentPlacements } from '@/shared/block-document-placements';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { linkOutlinePage, outlinePageContent } from '@/shared/outline-page';

/** Page creation and source replacement commit together; replay never repeats either write. */
export function createOutlinePage(
  repositories: LibraryDatabaseRepositories,
  references: ContentReferenceTargets,
  raw: OutlinePageCreateInput,
) {
  const input = outlinePageCreateInputSchema.parse(raw);
  return repositories.db
    .transaction(() => {
      const { db, articles } = repositories;
      if (db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
        throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
      const prefix = `outline-page:${input.requestId}:`;
      const pageId = `${prefix}${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
      const prior = db
        .prepare('SELECT id FROM articles WHERE id >= ? AND id < ? LIMIT 2')
        .all(prefix, `${prefix}~`) as { id: string }[];
      const linkFor = (id: string, title: string) => {
        const target = { kind: 'ARTICLE' as const, id };
        return { spaceId: input.spaceId, target, title, url: contentLinkUrl({ spaceId: input.spaceId, target }) };
      };
      const itemFor = (id: string) => {
        const item = repositories.creationItems.findForEntity({ kind: 'ARTICLE', id });
        if (!item) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
        return item;
      };
      if (prior.length) {
        if (prior.length !== 1 || prior[0].id !== pageId) throw new Error('OUTLINE_LINK_REQUEST_REUSED');
        const page = references.open({ source: { kind: 'ARTICLE', id: pageId } }).article;
        return {
          source: references.open({ source: { kind: 'ARTICLE', id: input.sourceArticleId } }).article,
          page,
          creationItem: itemFor(page.id),
          link: linkFor(page.id, page.content.title),
        };
      }
      const source = references.open({ source: { kind: 'ARTICLE', id: input.sourceArticleId } }).article;
      if (source.revisionId !== input.expectedRevisionId) throw new Error('OUTLINE_LINK_SOURCE_CHANGED');
      if (source.content.editorMode !== 'OUTLINE' || !source.content.document)
        throw new Error('OUTLINE_LINK_SOURCE_UNSUPPORTED');
      const page = outlinePageContent(source.content.document.root, input.selectedIds, input.untitledTitle, {
        spaceId: input.spaceId,
        articleId: source.id,
      });
      const transferred = transferredDocumentMedia(page.document, source.content.mediaBindings, []);
      const created = articles.save(
        {
          id: null,
          albumId: source.albumId,
          sourceInspirationStashId: null,
          consumeCreationDraftId: null,
          content: {
            schemaVersion: 2,
            editorMode: 'OUTLINE',
            title: page.title,
            document: transferred.document,
            markdown: blockDocumentMarkdown(transferred.document),
            mediaBindings: transferred.mediaBindings,
            coverAssetId: null,
          },
        },
        { requestId: pageId },
        localArticleWriteContext(db, input.requestId),
      );
      const link = linkFor(created.id, created.content.title);
      const document = blockDocumentSchema.parse({
        ...source.content.document,
        root: linkOutlinePage(source.content.document.root, page.roots, link.url, link.title),
      });
      const { mediaAssets: _media, ...content } = source.content;
      const saved = articles.saveSystemRevision({
        articleId: source.id,
        expectedRevisionId: source.revisionId,
        requestId: input.requestId,
        content: { ...content, document, markdown: blockDocumentMarkdown(document) },
        elements: blockDocumentPlacements(document),
      });
      return { source: saved, page: created, creationItem: itemFor(created.id), link };
    })
    .immediate();
}
