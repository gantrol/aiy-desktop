import { useRef } from 'react';
import { EditorContent } from '@tiptap/react';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { ContentSearchPreviewView } from '@/renderer/features/content-search/ContentSearchPreviewView';
import { ContentDocumentWorkspace } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { articleTitleClassName } from '@/renderer/lib/articleTypography';

function ReadOnlyDocument({ document }: { document: ContentDocument }) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const editor = useContentEditor({
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: document.markdown }] }] },
    editable: false,
    presentation: { typography: 'article', ariaLabel: document.title },
  });
  return (
    <ContentDocumentWorkspace
      documentWidth="STANDARD"
      scrollRootRef={scrollRootRef}
      title={<h1 className={articleTitleClassName}>{document.title}</h1>}
    >
      <EditorContent editor={editor} />
    </ContentDocumentWorkspace>
  );
}

export function SearchPreviewSample({
  item,
  active,
  failed,
  loading = false,
  onRetry,
}: {
  item: ContentLookupResult['items'][number] | null;
  active: boolean;
  failed: boolean;
  loading?: boolean;
  onRetry(): void;
}) {
  const document: ContentDocument | undefined = item
    ? {
        source: item.source,
        title: item.title,
        displayTitle: item.title,
        revisionId: 'storybook-revision',
        contentHash: 'storybook-content',
        markdown: item.preview,
        media: [],
        blocks: [],
      }
    : undefined;
  return (
    <ContentSearchPreviewView
      item={item}
      active={active}
      current={failed ? { failed: true } : loading ? null : { document }}
      onRetry={onRetry}
      renderEditor={(document) => <ReadOnlyDocument key={document.source.id} document={document} />}
    />
  );
}
