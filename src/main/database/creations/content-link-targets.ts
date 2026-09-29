import { localArticleWriteContext } from '@/main/database/creations/article-write-context';
import { createHash } from 'node:crypto';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import { referenceMetadata } from '@/main/database/creations/content-reference-metadata';
import type {
  ContentLinkInput,
  ContentLinkResult,
  ContentLinkUses,
  OutlineLinkedCreateInput,
} from '@/shared/contracts/content-links';
import {
  contentLinkInputSchema,
  contentLinkUrl,
  outlineLinkedCreateInputSchema,
} from '@/shared/contracts/content-links';
import { markdownBlockDocument, plainTextBlockDocument } from '@/shared/block-document-codecs';
import { createOutlineDocument } from '@/shared/outline-document';
import { contentLinkUseSites } from '@/shared/content-link-document';

/** Plain links use the existing document, article creation and navigation identities. */
export class ContentLinkTargets {
  constructor(
    private readonly repositories: LibraryDatabaseRepositories,
    private readonly references: ContentReferenceTargets,
  ) {}

  private assertSpace(spaceId: string) {
    if (this.repositories.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== spaceId)
      throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
  }

  resolve(raw: ContentLinkInput): ContentLinkResult {
    const input = contentLinkInputSchema.parse(raw);
    this.assertSpace(input.spaceId);
    const { target } = input;
    let title: string;
    if (target.kind === 'ARTICLE')
      title = this.references.open({
        source: { kind: 'ARTICLE', id: target.id },
        blockId: target.blockId,
      }).article.content.title;
    else {
      this.repositories.albums.assertAlbumAcceptsContent(target.id);
      title = referenceMetadata(this.repositories.db, [target])(target).title;
    }
    return { ...input, title, url: contentLinkUrl(input) };
  }

  create(raw: OutlineLinkedCreateInput): ContentLinkResult {
    const input = outlineLinkedCreateInputSchema.parse(raw);
    return this.repositories.db
      .transaction(() => {
        this.assertSpace(input.spaceId);
        // A namespaced operation key and immutable fingerprint provide a durable receipt
        // in the existing article identity. Replays cannot replace later edits or resurrect deletion.
        const prefix = `outline-link:${input.requestId}:`;
        const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const id = `${prefix}${fingerprint}`;
        const prior = this.repositories.db
          .prepare('SELECT id FROM articles WHERE id >= ? AND id < ? LIMIT 2')
          .all(prefix, `${prefix}~`) as { id: string }[];
        if (prior.length) {
          if (prior.length !== 1 || prior[0].id !== id) throw new Error('OUTLINE_LINK_REQUEST_REUSED');
          return this.resolve({
            spaceId: input.spaceId,
            target: { kind: 'ARTICLE', id },
          });
        }
        const source = this.references.open({
          source: { kind: 'ARTICLE', id: input.sourceArticleId },
          blockId: input.sourceBlockId,
        }).article;
        if (source.revisionId !== input.expectedRevisionId) throw new Error('OUTLINE_LINK_SOURCE_CHANGED');
        if (source.content.editorMode !== 'OUTLINE') throw new Error('OUTLINE_LINK_SOURCE_UNSUPPORTED');
        let matches = 0;
        const visit = (node: import('@/shared/contracts/block-document').BlockNode) => {
          if (node.attrs?.blockId === input.sourceBlockId && node.type === 'listItem') matches++;
          node.content?.forEach(visit);
        };
        if (source.content.document) visit(source.content.document.root);
        if (matches !== 1) throw new Error('REFERENCE_LOCATION_MISSING');
        const document = plainTextBlockDocument('');
        const created = this.repositories.articles.save(
          {
            id: null,
            albumId: input.albumId,
            sourceInspirationStashId: null,
            consumeCreationDraftId: null,
            content: {
              schemaVersion: 2,
              title: input.title,
              document: input.format === 'OUTLINE' ? createOutlineDocument(document) : document,
              ...(input.format === 'OUTLINE' ? { editorMode: 'OUTLINE' as const } : {}),
              markdown: '',
              mediaBindings: [],
              coverAssetId: null,
            },
          },
          { requestId: id },
          localArticleWriteContext(this.repositories.db, input.requestId),
        );
        return {
          spaceId: input.spaceId,
          target: { kind: 'ARTICLE' as const, id: created.id },
          title: created.content.title,
          url: contentLinkUrl({
            spaceId: input.spaceId,
            target: { kind: 'ARTICLE', id: created.id },
          }),
        };
      })
      .immediate();
  }

  uses(raw: ContentLinkInput, offset: number): ContentLinkUses {
    const input = contentLinkInputSchema.parse(raw);
    this.assertSpace(input.spaceId);
    // Bounded pages include old Markdown articles, but never synthesize block identities for them.
    const rows = this.repositories.db
      .prepare(
        "SELECT id FROM articles WHERE deleted_at IS NULL AND status='ACTIVE' ORDER BY updated_at DESC,id LIMIT 41 OFFSET ?",
      )
      .all(offset) as { id: string }[];
    const items: ContentLinkUses['items'] = [];
    let unavailable = 0;
    for (const row of rows.slice(0, 40)) {
      let article: import('@/shared/contracts').ArticleDto;
      try {
        article = this.references.open({
          source: { kind: 'ARTICLE', id: row.id },
        }).article;
      } catch (reason) {
        if (String(reason).includes('REFERENCE_SOURCE_UNAVAILABLE')) {
          unavailable++;
          continue;
        }
        throw reason;
      }
      const document = article.content.document ?? markdownBlockDocument(article.content.markdown);
      for (const site of contentLinkUseSites(document.root, input, Boolean(article.content.document))) {
        items.push({
          source: {
            kind: 'ARTICLE',
            id: article.id,
            revisionId: article.revisionId,
          },
          title: article.content.title,
          ...site,
        });
        if (items.length > 1000) throw new Error('REFERENCE_USES_LIMIT');
      }
    }
    return {
      scope: 'CURRENT_ARTICLES',
      items,
      unavailable,
      nextOffset: rows.length > 40 ? offset + 40 : null,
    };
  }
}
