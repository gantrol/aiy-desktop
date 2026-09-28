import { createHash } from 'node:crypto';
import type { LibraryDatabase } from '@/main/database';
import { contentError } from '@/main/agent/content-read';
import { normalizeArticleContent } from '@/shared/article-revision';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { contentLookupResultSchema } from '@/shared/contracts/content-search';
import {
  agentContentSearchResultSchema,
  agentContentTarget,
  agentContentUpdateResultSchema,
  agentContentUrl,
  type AgentContentSearchRequest,
  type AgentContentUpdateRequest,
} from '@/shared/contracts/agent-content';

export function searchAgentContent(database: LibraryDatabase, request: AgentContentSearchRequest, signal: AbortSignal) {
  signal.throwIfAborted();
  if (database.getLocalSpace().id !== request.spaceId) throw contentError('SPACE_CONFLICT');
  const { protocolVersion: _protocolVersion, spaceId, ...input } = request;
  const result = contentLookupResultSchema.parse(
    database.executeContentLibrary({ kind: 'lookup', input: { ...input, type: 'ARTICLE' } }),
  );
  return agentContentSearchResultSchema.parse({
    ...result,
    spaceId,
    items: result.items.map((item) => ({
      ...item,
      url: agentContentUrl({ spaceId, target: 'article', entityId: item.source.id }),
    })),
  });
}

/** Keep the structured document, attachments and anchors on the existing revision save lane. */
export function updateAgentContent(database: LibraryDatabase, request: AgentContentUpdateRequest, signal: AbortSignal) {
  const target = agentContentTarget(request.url);
  if (!target || target.target !== 'article') throw contentError('INVALID_LINK');
  signal.throwIfAborted();
  return database.db
    .transaction(() => {
      if (database.getLocalSpace().id !== target.spaceId) throw contentError('SPACE_CONFLICT');
      const content = normalizeArticleContent(request.content);
      const result = database.saveArticleRevision(
        {
          requestId: request.requestId,
          articleId: target.entityId,
          expectedRevisionId: request.expectedRevisionId,
          sessionEpoch: request.requestId,
          draftSeq: 0,
          cause: 'SYSTEM',
          content,
          contentHash: createHash('sha256').update(canonicalArticleContentJson(content)).digest('hex'),
          elements: request.elements,
          commentAnchors: request.commentAnchors,
        },
        { entry: 'CLI', requestId: request.requestId, provenance: request.provenance },
      );
      if (result.status === 'CONFLICT') throw contentError('REVISION_CONFLICT');
      return agentContentUpdateResultSchema.parse({
        spaceId: target.spaceId,
        entityId: target.entityId,
        status: result.status,
        requestId: request.requestId,
        url: agentContentUrl(target),
        revisionId: result.article.revisionId,
        contentHash: result.contentHash,
        createdRevision: result.createdRevision,
      });
    })
    .immediate();
}
