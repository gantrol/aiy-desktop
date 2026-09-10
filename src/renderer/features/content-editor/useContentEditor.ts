import { BlockIdentity } from '@/renderer/features/content-editor/blockIdentityExtension';
import { ContentLinkCardExtension } from '@/renderer/features/content-editor/contentLinkCardExtension';
import { createContentLinkPasteExtension } from '@/renderer/features/content-editor/contentLinkPasteExtension';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import {
  DocumentImageMediaStore,
  createDocumentImageExtension,
} from '@/renderer/features/content-editor/contentImageExtension';
import { contentReferenceExtension } from '@/renderer/features/content-editor/ContentReferenceExtension';
import { CjkStrongMarkdown } from '@/renderer/features/video-documents/cjkStrongMarkdown';
import { VideoDocumentListIndent } from '@/renderer/features/video-documents/videoDocumentListIndent';
import { VideoDocumentTableView } from '@/renderer/features/video-documents/videoDocumentTableView';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import { Node, type Extensions } from '@tiptap/core';
import FindAndReplace from '@tiptap/extension-find-and-replace';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { useEditor, type UseEditorOptions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useMemo, type DependencyList } from 'react';

function promptAtom(name: string) {
  return Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes: () =>
      Object.fromEntries(
        [
          'editorKey',
          'termId',
          'paletteId',
          'revisionNo',
          'paletteRevisionId',
          'parameterValues',
          'promptLocale',
          'promptText',
          'label',
        ].map((key) => [key, { default: null, rendered: false }]),
      ),
    parseHTML: () => [{ tag: `span[data-type="${name}"]` }],
    renderHTML: ({ node }) => ['span', { 'data-type': name }, String(node.attrs.promptText ?? node.attrs.label ?? '')],
    renderText: ({ node }) => String(node.attrs.promptText ?? node.attrs.label ?? ''),
    renderMarkdown: (node) => String(node.attrs?.promptText ?? node.attrs?.label ?? ''),
  });
}

/** Every host uses the same schema. Hosts override views and supply business commands. */
export function createContentEditorExtensions(overrides: Extensions = []): Extensions {
  const base: Extensions = [
    BlockIdentity,
    ContentLinkCardExtension,
    VideoDocumentListIndent,
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        defaultProtocol: 'https',
        markdownLinks: true,
        protocols: ['codex'],
        isAllowedUri: (url, { defaultValidate }) =>
          url.trimStart().toLowerCase().startsWith('codex:')
            ? parseCodexThreadHref(url) !== null
            : defaultValidate(url),
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    createDocumentImageExtension(new DocumentImageMediaStore({ media: [], mediaBindings: [] })),
    contentReferenceExtension(() => undefined),
    TableKit.configure({ table: { resizable: false, renderWrapper: true, View: VideoDocumentTableView } }),
    FindAndReplace.configure({ injectCSS: false, searchDebounceMs: 0, useRegex: false }),
    CjkStrongMarkdown,
    promptAtom('creatorTerm'),
    promptAtom('creatorRecipe'),
    Markdown,
  ];
  const replaced = new Set(overrides.map((extension) => extension.name));
  return [...base.filter((extension) => !replaced.has(extension.name)), ...overrides];
}

export function useContentEditor(options: UseEditorOptions, dependencies?: DependencyList) {
  const providers = useContentLinkProviders();
  const currentProviders = useStableCallback(() => providers);
  const extensions = useMemo(
    () =>
      createContentEditorExtensions([...(options.extensions ?? []), createContentLinkPasteExtension(currentProviders)]),
    [options.extensions, currentProviders],
  );
  return useEditor({ ...options, extensions }, dependencies);
}
