import { z } from 'zod';
import { linkCardUrlSchema, linkPreviewSchema } from '@/shared/contracts/link-card';
import {
  contentDocumentSchema,
  contentReferenceSchema,
  contentSearchResultSchema,
  contentNoteOpenSchema,
  contentMediaSchema,
  type ContentLibraryCommand,
  type ContentLibraryApi,
} from '@/shared/contracts/content-library';
import { desktopNoteSchema } from '@/shared/contracts/desktop-petals';

export function createContentLibraryBridge(
  invoke: (command: ContentLibraryCommand) => Promise<unknown>,
): ContentLibraryApi {
  return {
    linkPreview: async (url) =>
      linkPreviewSchema.parse(await invoke({ kind: 'link-preview', url: linkCardUrlSchema.parse(url) })),
    linkOpen: async (url) => {
      await invoke({ kind: 'link-open', url: linkCardUrlSchema.parse(url) });
    },
    search: async (query, offset = 0) =>
      contentSearchResultSchema.parse(await invoke({ kind: 'search', query, offset })),
    read: async (source) => contentDocumentSchema.parse(await invoke({ kind: 'read', source })),
    capture: async (input) => contentReferenceSchema.parse(await invoke({ kind: 'capture', ...input })),
    references: async (ids) => z.array(contentReferenceSchema).parse(await invoke({ kind: 'references', ids })),
    render: async (markdown) =>
      z
        .object({ markdown: z.string(), media: z.array(contentMediaSchema) })
        .parse(await invoke({ kind: 'render', markdown })),
    noteOpen: async (id) => contentNoteOpenSchema.parse(await invoke({ kind: 'note-open', id })),
    noteSave: async (input) => desktopNoteSchema.parse(await invoke({ kind: 'note-save', input })),
    noteCheckpoint: async (input) => {
      await invoke({ kind: 'note-checkpoint', input });
    },
    reveal: async (source) => {
      await invoke({ kind: 'reveal', source });
    },
  };
}
