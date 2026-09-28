import { transferOutlineItems } from '@/main/database/creations/outline-transfer';
import { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import { PublishingMaskRepository } from '@/main/database/creations/publishing-mask-repository';
import { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import { ContentLinkTargets } from '@/main/database/creations/content-link-targets';
import { ContentFollowingReferences } from '@/main/database/creations/content-following-references';
import { ContentReferenceHistory } from '@/main/database/creations/content-reference-history';
import { isDocumentSource } from '@/shared/contracts/content-source';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryCommand } from '@/shared/contracts/content-library';
import { ReadableContentRepository } from '@/main/database/assets/readable-content-repository';
import { ContentSearchRepository } from '@/main/database/search/content-search-repository';
import { projectArticleStructure } from '@/shared/article-structure';
import { ARTICLE_STRUCTURE_PAGE_SIZE, type ArticleStructureInput } from '@/shared/contracts/article-structure';

function readArticleStructure(
  repositories: LibraryDatabaseRepositories,
  references: ContentReferenceTargets,
  input: ArticleStructureInput,
) {
  if (repositories.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
    throw new Error('CONTENT_LIBRARY_SPACE_CHANGED');
  const { article } = references.open({ source: { kind: 'ARTICLE', id: input.articleId } });
  if (input.expectedRevisionId && article.revisionId !== input.expectedRevisionId)
    throw new Error('ARTICLE_STRUCTURE_CHANGED');
  const nodes = projectArticleStructure(article.content.document, article.content.mediaBindings);
  const offset = input.offset ?? 0;
  const next = offset + ARTICLE_STRUCTURE_PAGE_SIZE;
  return {
    spaceId: input.spaceId,
    articleId: article.id,
    revisionId: article.revisionId,
    nodes: nodes.slice(offset, next),
    nextOffset: next < nodes.length ? next : null,
    legacy: !article.content.document,
  };
}

function renderContent(
  repositories: LibraryDatabaseRepositories,
  content: ContentLibraryRepository,
  command: Extract<ContentLibraryCommand, { kind: 'render' | 'freeze' | 'render-frozen' }>,
) {
  if (
    command.expectedSpaceId !== undefined &&
    repositories.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !==
      command.expectedSpaceId
  )
    return { errorCode: 'CONTENT_LIBRARY_SPACE_CHANGED' as const };
  if (command.kind === 'freeze') return content.freeze(command.markdown);
  if (command.kind === 'render-frozen') return content.renderFrozen(command.markdown, command.resolutionId);
  return content.render(command.markdown);
}

export function createContentLibraryApi(repositories: LibraryDatabaseRepositories) {
  const content = new ContentLibraryRepository(repositories);
  const search = new ContentSearchRepository(repositories.db, (source) => content.read(source));
  const references = new ContentReferenceTargets(repositories, content);
  const links = new ContentLinkTargets(repositories, references);
  const following = new ContentFollowingReferences(repositories, content, references);
  content.attachFollowingResolver((ids) => following.resolve(ids));
  const referenceHistory = new ContentReferenceHistory(repositories, content);
  repositories.articles.attachReferenceHistory((articleId, revisionId, input) =>
    referenceHistory.capture(articleId, revisionId, input),
  );
  const readable = new ReadableContentRepository(repositories, content);
  repositories.libraryFileView.attachContentProjection(readable);
  function inspectReference(target: import('@/shared/contracts/content-source').ReferenceTarget) {
    return repositories.db.transaction(() => {
      const preview = references.inspect(target);
      const historical =
        isDocumentSource(target.source) && target.source.kind === 'ARTICLE' && target.source.revisionId
          ? referenceHistory.resolutionFor(target.source.id, target.source.revisionId, preview.markdown)
          : undefined;
      const resolution = historical
        ? { resolutionId: historical, ...content.renderFrozen(preview.markdown, historical) }
        : content.freeze(preview.markdown);
      return {
        ...preview,
        resolutionId: resolution.resolutionId,
        markdown: resolution.markdown,
        media: [...new Map([...preview.media, ...resolution.media].map((asset) => [asset.assetId, asset])).values()],
      };
    })();
  }
  return {
    contentLibrary: content,
    publishingMasks: new PublishingMaskRepository(repositories, content),
    ensureContentDirectory: (source: import('@/shared/contracts/content-library').ContentSource) =>
      readable.ensure(source),
    executeContentLibrary(
      command: Exclude<
        ContentLibraryCommand,
        { kind: 'reveal' | 'link-preview' | 'link-open' | 'reference-copy' | 'agent-link' }
      >,
    ) {
      switch (command.kind) {
        case 'reference-history':
          return referenceHistory.read(command.articleId, command.revisionId, command.spaceId);
        case 'article-structure':
          return readArticleStructure(repositories, references, command.input);
        case 'content-link-resolve':
          return links.resolve(command.input);
        case 'outline-linked-create':
          return links.create(command.input);
        case 'content-link-uses':
          return links.uses(command.input, command.offset);
        case 'lookup':
          return search.lookup(command.input);
        case 'reference-search':
          return references.search(command);
        case 'reference-inspect':
          return inspectReference(command.target);
        case 'reference-open':
          return references.open(command.target, command.referenceId);
        case 'reference-capture':
          return references.capture(command.target, command.expectedVersion, command.resolutionId);
        case 'reference-follow':
          return following.follow(command.target, command.expectedVersion);
        case 'reference-resolve':
          return following.resolve(command.ids);
        case 'reference-freeze':
          return following.freeze(command.id, command.expectedRevisionId, command.expectedContentHash);
        case 'reference-uses':
          return references.uses(command.target, command.offset);
        case 'search':
          return content.search(command.query, command.offset);
        case 'read':
          return content.read(command.source);
        case 'read-current':
          return content.readCurrent(command.source);
        case 'capture':
          return content.capture(command);
        case 'references':
          return content.references(command.ids);
        case 'render':
        case 'freeze':
        case 'render-frozen':
          return renderContent(repositories, content, command);
        case 'note-open':
          return content.noteOpen(command.id);
        case 'note-save':
          return content.noteSave(command.input);
        case 'outline-transfer':
          return transferOutlineItems(repositories, command.input);
        case 'note-checkpoint':
          return content.noteCheckpoint(command.input);
        case 'note-comment-mutate':
          return content.noteCommentMutate(command.input);
      }
    },
  };
}
