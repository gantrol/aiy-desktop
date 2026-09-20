import { BlockIdentity } from '@/renderer/features/content-editor/blockIdentityExtension';
import { ContentLinkCardExtension } from '@/renderer/features/content-editor/contentLinkCardExtension';
import { createContentLinkPasteExtension } from '@/renderer/features/content-editor/contentLinkPasteExtension';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  contentTypographyClassName,
  type ContentTypography,
} from '@/renderer/features/content-editor/contentEditorTypography';
import { ContentEditorKeyboard } from '@/renderer/features/content-editor/contentEditorKeyboard';
import { OutlinePointerSelection } from '@/renderer/features/content-editor/outlinePointerSelection';
import {
  DocumentImageMediaStore,
  createDocumentImageExtension,
} from '@/renderer/features/content-editor/contentImageExtension';
import { contentReferenceExtension } from '@/renderer/features/content-editor/ContentReferenceExtension';
import {
  ContentReveal,
  ContentRevealAnswer,
  ContentRevealInitial,
} from '@/renderer/features/content-editor/contentRevealExtension';
import { CjkStrongMarkdown } from '@/renderer/features/video-documents/cjkStrongMarkdown';
import { VideoDocumentTableView } from '@/renderer/features/video-documents/videoDocumentTableView';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';
import { Node, type Extensions } from '@tiptap/core';
import FindAndReplace from '@tiptap/extension-find-and-replace';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
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
export function createContentEditorExtensions(
  overrides: Extensions,
  detailsLabels: { expand: string; collapse: string },
): Extensions {
  const base: Extensions = [
    BlockIdentity,
    ContentLinkCardExtension,
    Details.configure({
      persist: false,
      HTMLAttributes: { class: 'my-4 border-l-2 border-border pl-3' },
      renderToggleButton: ({ element, isOpen }) => {
        element.className =
          'mr-1 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted';
        element.textContent = isOpen ? '▾' : '▸';
        element.setAttribute('aria-label', isOpen ? detailsLabels.collapse : detailsLabels.expand);
      },
    }),
    DetailsSummary.configure({ HTMLAttributes: { class: 'inline min-h-6 font-medium' } }),
    DetailsContent.configure({ HTMLAttributes: { class: 'mt-2' } }),
    ContentReveal,
    ContentRevealInitial,
    ContentRevealAnswer,
    ContentEditorKeyboard,
    ...(overrides.some((extension) => extension.name === 'outlineEditing') ? [OutlinePointerSelection] : []),
    StarterKit.configure({
      trailingNode: overrides.some((extension) => extension.name === 'outlineEditing') ? false : undefined,
      listItem: overrides.some((extension) => extension.name === 'listItem') ? false : undefined,
      bulletList: overrides.some((extension) => extension.name === 'bulletList') ? false : undefined,
      orderedList: overrides.some((extension) => extension.name === 'orderedList') ? false : undefined,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        defaultProtocol: 'https',
        markdownLinks: true,
        protocols: ['codex', 'aiy', 'aiy-figure'],
        isAllowedUri: (url, { defaultValidate }) =>
          url.trimStart().toLowerCase().startsWith('aiy-figure:')
            ? contentFigureReferenceAssetId(url) !== null
            : url.trimStart().toLowerCase().startsWith('codex:')
              ? parseCodexThreadHref(url) !== null
              : url.trimStart().toLowerCase().startsWith('aiy:')
                ? parseAiyDeepLink(url) !== null
                : defaultValidate(url),
      },
    }),
    ...(overrides.some((extension) => extension.name === 'taskList') ? [] : [TaskList]),
    // The live node view does not use renderHTML, which normally supplies data-type.
    TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
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

interface ContentEditorOptions extends UseEditorOptions {
  presentation: {
    typography: ContentTypography;
    ariaLabel: string;
    className?: string;
  };
}

/** Hosts choose density and layout; schema, semantic formatting and basic input behavior stay shared. */
export function useContentEditor({ presentation, ...options }: ContentEditorOptions, dependencies?: DependencyList) {
  const providers = useContentLinkProviders();
  const detailsCopy = useI18n().messages.videoDocuments.editor.richText;
  const currentProviders = useStableCallback(() => providers);
  const extensions = useMemo(
    () =>
      createContentEditorExtensions(
        [...(options.extensions ?? []), createContentLinkPasteExtension(currentProviders)],
        { expand: detailsCopy.expandDetails, collapse: detailsCopy.collapseDetails },
      ),
    [options.extensions, currentProviders, detailsCopy.expandDetails, detailsCopy.collapseDetails],
  );
  const hostAttributes = options.editorProps?.attributes;
  return useEditor(
    {
      enableContentCheck: true,
      immediatelyRender: true,
      ...options,
      extensions,
      editorProps: {
        ...options.editorProps,
        attributes: (state) => {
          const attributes = typeof hostAttributes === 'function' ? hostAttributes(state) : hostAttributes;
          return {
            ...attributes,
            role: 'textbox',
            'aria-label': presentation.ariaLabel,
            'aria-multiline': 'true',
            class: cn(
              contentTypographyClassName(presentation.typography),
              'outline-none',
              presentation.className,
              attributes?.class,
            ),
          };
        },
      },
    },
    dependencies,
  );
}
