import { z } from 'zod';
import { agentContentLinkResultSchema } from '@/shared/contracts/agent-content';
import { linkCardUrlSchema, linkPreviewSchema } from '@/shared/contracts/link-card';
import {
  contentDocumentSchema,
  contentReferenceSchema,
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
    agentLink: async (target) => agentContentLinkResultSchema.parse(await invoke({ kind: 'agent-link', target })),
    lookup: async (input) =>
      contentLookupResultSchema.parse(await invoke({ kind: 'lookup', input: contentLookupInputSchema.parse(input) })),
    referenceSearch: async (category, query, offset = 0) =>
      referenceSearchResultSchema.parse(await invoke({ kind: 'reference-search', category, query, offset })),
    referenceInspect: async (target) =>
      referencePreviewSchema.parse(await invoke({ kind: 'reference-inspect', target })),
    referenceOpen: async (target, referenceId) =>
      referenceOpenResultSchema.parse(await invoke({ kind: 'reference-open', target, referenceId })),
    referenceCapture: async (target, expectedVersion) =>
      contentReferenceSchema.parse(await invoke({ kind: 'reference-capture', target, expectedVersion })),
    referenceCopy: async (id, format) => {
      await invoke({ kind: 'reference-copy', id, format });
    },
    referenceUses: async (target, offset = 0) =>
      referenceUsesSchema.parse(await invoke({ kind: 'reference-uses', target, offset })),
    linkPreview: async (url) =>
      linkPreviewSchema.parse(await invoke({ kind: 'link-preview', url: linkCardUrlSchema.parse(url) })),
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
