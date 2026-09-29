import { createHash } from 'node:crypto';
import { readProvenanceV1 } from '@/main/agent/content-provenance-v1';
import { pathToFileURL } from 'node:url';
import type { LibraryDatabase } from '@/main/database';
import {
  agentContentEditSnapshotSchema,
  agentContentReadResultSchema,
  agentContentTarget,
  agentContentUrl,
  type AgentContentReadRequest,
  type AgentContentTarget,
} from '@/shared/contracts/agent-content';
import { articleCommentAnchorUpdates } from '@/shared/contracts/article';
import { plainTextMarkdown } from '@/shared/content-document';
import {
  normalizedArticleMediaPath,
  referencedArticleMediaBindings,
  rewriteArticleImageReferences,
} from '@/main/creations/article-media-references';

export function contentError(code: string) {
  return Object.assign(new Error(`AIY_AGENT_CONTENT_${code}`), { code: `AIY_AGENT_CONTENT_${code}` });
}

export function assertAgentContentTarget(database: LibraryDatabase, target: AgentContentTarget) {
  if (database.getLocalSpace().id !== target.spaceId) throw contentError('SPACE_CONFLICT');
  if (target.target === 'article') {
    database.contentLibrary.readCurrent({ kind: 'ARTICLE', id: target.entityId });
  } else if (!database.getGalleryMaterial(target.entityId, 'en')) {
    throw contentError('NOT_FOUND');
  }
}

/** The worker reads one saved snapshot; the CLI never opens a database or a renderer. */
export async function readAgentContent(
  database: LibraryDatabase,
  request: AgentContentReadRequest,
  signal: AbortSignal,
) {
  const target = agentContentTarget(request.url);
  if (!target) throw contentError('INVALID_LINK');
  signal.throwIfAborted();
  const snapshot = database.db.transaction(() => {
    if (database.getLocalSpace().id !== target.spaceId) throw contentError('SPACE_CONFLICT');
    if (target.target === 'article') {
      const document = database.contentLibrary.readCurrent({ kind: 'ARTICLE', id: target.entityId });
      const expanded = database.contentLibrary.render(document.markdown);
      const bindings = referencedArticleMediaBindings(expanded.markdown, [...document.media, ...expanded.media], null);
      const article = request.includeEditSnapshot ? database.getArticle(target.entityId) : null;
      const editSnapshot = article
        ? (() => {
            const { mediaAssets: _mediaAssets, ...content } = article.content;
            return agentContentEditSnapshotSchema.parse({
              content,
              elements: article.elements,
              commentAnchors: articleCommentAnchorUpdates(article.comments),
            });
          })()
        : undefined;
      return {
        title: document.displayTitle,
        revisionId: document.revisionId,
        markdown: expanded.markdown,
        bindings,
        provenance: readProvenanceV1(database.db, target.entityId, document.revisionId),
        ...(editSnapshot ? { editSnapshot } : {}),
      };
    }
    const material = database.getGalleryMaterial(target.entityId, 'en');
    if (!material) throw contentError('NOT_FOUND');
    if (material.kind === 'TEXT') {
      return {
        title: material.text.text.split(/\r?\n/, 1)[0] ?? '',
        revisionId: null,
        markdown: plainTextMarkdown(material.text.text),
        bindings: [],
      };
    }
    const media = material.media;
    return {
      title: media.metadata?.displayName || media.metadata?.originalName || media.asset.id,
      revisionId: null,
      markdown: plainTextMarkdown(media.metadata?.note ?? ''),
      bindings: [{ path: media.asset.mediaUrl, assetId: media.asset.id }],
    };
  })();
  const ids = [...new Set(snapshot.bindings.map((binding) => binding.assetId))];
  if (ids.length > 100 || snapshot.markdown.length > 1_000_000) throw contentError('LIMIT');
  signal.throwIfAborted();
  const files = await database.resolveAssetFilesAsync(ids);
  signal.throwIfAborted();
  if (files.size !== ids.length) throw contentError('MEDIA_UNAVAILABLE');
  const paths = new Map<string, string>();
  const assetUrls = new Map<string, string>();
  const media = ids.map((id) => {
    const file = files.get(id)!;
    const url = pathToFileURL(file.absolutePath).href;
    assetUrls.set(id, url);
    return {
      assetId: id,
      absolutePath: file.absolutePath,
      mimeType: file.mimeType,
      sha256: file.objectHash,
      byteSize: file.byteSize,
      width: file.width,
      height: file.height,
    };
  });
  for (const binding of snapshot.bindings) {
    paths.set(normalizedArticleMediaPath(binding.path), assetUrls.get(binding.assetId)!);
  }
  const markdown = rewriteArticleImageReferences(snapshot.markdown, paths, assetUrls);
  return agentContentReadResultSchema.parse({
    ...target,
    url: agentContentUrl(target),
    title: snapshot.title,
    revisionId: snapshot.revisionId,
    contentHash: createHash('sha256').update(snapshot.markdown).digest('hex'),
    markdown,
    ...('provenance' in snapshot ? { provenance: snapshot.provenance } : {}),
    ...('editSnapshot' in snapshot ? { editSnapshot: snapshot.editSnapshot } : {}),
    media,
  });
}
