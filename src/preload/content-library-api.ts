import { z } from 'zod';
import { articleStructureInputSchema, articleStructurePageSchema } from '@/shared/contracts/article-structure';
import { outlineTransferResultSchema } from '@/shared/contracts/outline-transfer';
import { contentLinkResultSchema, contentLinkUsesSchema } from '@/shared/contracts/content-links';
import { agentContentLinkResultSchema } from '@/shared/contracts/agent-content';
import { linkCardUrlSchema, linkPreviewSchema } from '@/shared/contracts/link-card';
import {
  contentDocumentSchema,
  contentReferenceSchema,
  resolvedContentReferenceSchema,
  contentResolutionSchema,
  referenceHistoryResultSchema,
  contentSearchResultSchema,
  contentNoteOpenSchema,
  contentRenderInvocationSchema,
  referencePreviewSchema,
  referenceOpenResultSchema,
  referenceSearchResultSchema,
  referenceUsesSchema,
  type ContentLibraryCommand,
  type ContentLibraryApi,
} from '@/shared/contracts/content-library';
import { desktopNoteSchema, noteCommentMutationResultSchema } from '@/shared/contracts/desktop-petals';
import { contentLookupInputSchema, contentLookupResultSchema } from '@/shared/contracts/content-search';

export function createContentLibraryBridge(
  invoke: (command: ContentLibraryCommand) => Promise<unknown>,
): ContentLibraryApi {
  return {
    referenceHistory: async (articleId, revisionId, spaceId) =>
      referenceHistoryResultSchema.parse(await invoke({ kind: 'reference-history', articleId, revisionId, spaceId })),
    articleStructure: async (input) =>
      articleStructurePageSchema.parse(
        await invoke({ kind: 'article-structure', input: articleStructureInputSchema.parse(input) }),
      ),
    outlineTransfer: async (input) =>
      outlineTransferResultSchema.parse(await invoke({ kind: 'outline-transfer', input })),
    linkResolve: async (input) => contentLinkResultSchema.parse(await invoke({ kind: 'content-link-resolve', input })),
    outlineLinkedCreate: async (input) =>
      contentLinkResultSchema.parse(await invoke({ kind: 'outline-linked-create', input })),
    linkUses: async (input, offset = 0) =>
      contentLinkUsesSchema.parse(await invoke({ kind: 'content-link-uses', input, offset })),
    agentLink: async (target) => agentContentLinkResultSchema.parse(await invoke({ kind: 'agent-link', target })),
    lookup: async (input) =>
      contentLookupResultSchema.parse(await invoke({ kind: 'lookup', input: contentLookupInputSchema.parse(input) })),
    referenceSearch: async (category, query, offset = 0) =>
      referenceSearchResultSchema.parse(await invoke({ kind: 'reference-search', category, query, offset })),
    referenceInspect: async (target) =>
      referencePreviewSchema.parse(await invoke({ kind: 'reference-inspect', target })),
    referenceOpen: async (target, referenceId) =>
      referenceOpenResultSchema.parse(await invoke({ kind: 'reference-open', target, referenceId })),
    referenceCapture: async (target, expectedVersion, resolutionId) =>
      contentReferenceSchema.parse(await invoke({ kind: 'reference-capture', target, expectedVersion, resolutionId })),
    referenceFollow: async (target, expectedVersion) =>
      contentReferenceSchema.parse(await invoke({ kind: 'reference-follow', target, expectedVersion })),
    referenceResolve: async (ids) =>
      z.array(resolvedContentReferenceSchema).parse(await invoke({ kind: 'reference-resolve', ids })),
    referenceFreeze: async (id, expectedRevisionId, expectedContentHash) =>
      contentReferenceSchema.parse(
        await invoke({ kind: 'reference-freeze', id, expectedRevisionId, expectedContentHash }),
      ),
    referenceCopy: async (id, format, options) => {
      await invoke({ kind: 'reference-copy', id, format, ...options });
    },
    referenceUses: async (target, offset = 0) =>
      referenceUsesSchema.parse(await invoke({ kind: 'reference-uses', target, offset })),
    linkPreview: async (url, refresh) =>
      linkPreviewSchema.parse(await invoke({ kind: 'link-preview', url: linkCardUrlSchema.parse(url), refresh })),
    linkOpen: async (url) => {
      await invoke({ kind: 'link-open', url: linkCardUrlSchema.parse(url) });
    },
    search: async (query, offset = 0) =>
      contentSearchResultSchema.parse(await invoke({ kind: 'search', query, offset })),
    read: async (source) => contentDocumentSchema.parse(await invoke({ kind: 'read', source })),
    readCurrent: async (source) => contentDocumentSchema.parse(await invoke({ kind: 'read-current', source })),
    capture: async (input) => contentReferenceSchema.parse(await invoke({ kind: 'capture', ...input })),
    references: async (ids) => z.array(contentReferenceSchema).parse(await invoke({ kind: 'references', ids })),
    render: async (markdown, expectedSpaceId) => {
      const result = contentRenderInvocationSchema.parse(await invoke({ kind: 'render', markdown, expectedSpaceId }));
      if ('errorCode' in result) {
        throw Object.assign(new Error(result.errorCode), { code: result.errorCode });
      }
      return result;
    },
    freeze: async (markdown, expectedSpaceId) => {
      const raw = await invoke({ kind: 'freeze', markdown, expectedSpaceId });
      if (raw && typeof raw === 'object' && 'errorCode' in raw)
        throw Object.assign(new Error(String(raw.errorCode)), { code: raw.errorCode });
      return contentResolutionSchema.parse(raw);
    },
    renderFrozen: async (markdown, resolutionId, expectedSpaceId) => {
      const result = contentRenderInvocationSchema.parse(
        await invoke({ kind: 'render-frozen', markdown, resolutionId, expectedSpaceId }),
      );
      if ('errorCode' in result) throw Object.assign(new Error(result.errorCode), { code: result.errorCode });
      return result;
    },
    noteOpen: async (id) => contentNoteOpenSchema.parse(await invoke({ kind: 'note-open', id })),
    noteSave: async (input) => desktopNoteSchema.parse(await invoke({ kind: 'note-save', input })),
    noteCheckpoint: async (input) => {
      await invoke({ kind: 'note-checkpoint', input });
    },
    noteCommentMutate: async (input) =>
      noteCommentMutationResultSchema.parse(await invoke({ kind: 'note-comment-mutate', input })),
    reveal: async (source) => {
      await invoke({ kind: 'reveal', source });
    },
  };
}
