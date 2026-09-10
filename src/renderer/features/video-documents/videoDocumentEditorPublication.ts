import {
  articleElementPlacements,
  captureArticleEditorLocation,
  mappedArticleCommentAnchors,
} from '@/renderer/features/video-documents/articleElementIdentity';
import { normalizeMarkdownForWysiwyg } from '@/renderer/features/video-documents/markdownForWysiwyg';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type {
  ArticleCommentAnchorUpdateInput,
  ArticleCommentDto,
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
} from '@/shared/contracts';
import { captureBlockDocument, type BlockDocument } from '@/shared/contracts/block-document';
import type { Editor } from '@tiptap/core';

export interface VideoDocumentWysiwygPersistenceSnapshot {
  markdown: string;
  document?: BlockDocument;
  articleElements: ArticleElementPlacementInput[];
  commentAnchors: ArticleCommentAnchorUpdateInput[];
}

export type VideoDocumentArticleElementsChangeReason = 'hydrate' | 'document' | 'identity';

interface PublicationRefs {
  comments: { current: readonly ArticleCommentDto[] };
  persistence: { current: VideoDocumentWysiwygPersistenceSnapshot };
  lastMarkdown: { current: string };
  onChange: { current(markdown: string): void };
  onDocumentChange?: { current: ((document: BlockDocument) => void) | undefined };
  callbacks: {
    current: {
      onArticleElementsChange?(
        elements: readonly ArticleElementPlacementInput[],
        reason: VideoDocumentArticleElementsChangeReason,
      ): void;
      onArticleLocationChange?(location: ArticleEditorLocationDto): void;
      onArticleEditLocation?(location: ArticleEditorLocationDto): void;
    };
  };
}

export function captureVideoDocumentEditor(
  editor: Editor,
  articleElementsEnabled: boolean,
  comments: readonly ArticleCommentDto[],
): VideoDocumentWysiwygPersistenceSnapshot {
  let markdown: string | undefined;
  const document = captureBlockDocument(editor.getJSON());
  const image = editor.extensionManager.extensions.find((extension) => extension.name === 'image');
  const bindings: readonly { path: string; assetId: string }[] =
    image?.options.mediaStore?.getSnapshot().mediaBindings ?? [];
  return {
    get markdown() {
      return (markdown ??= normalizeMarkdownForWysiwyg(blockDocumentMarkdown(document, bindings)));
    },
    document,
    articleElements: articleElementsEnabled ? articleElementPlacements(editor) : [],
    commentAnchors: articleElementsEnabled ? mappedArticleCommentAnchors(editor, comments) : [],
  };
}

export function publishVideoDocumentEditor(
  editor: Editor,
  identityChanged: boolean,
  articleElementsEnabled: boolean,
  refs: PublicationRefs,
) {
  if (editor.isDestroyed) return;
  const snapshot = captureVideoDocumentEditor(editor, articleElementsEnabled, refs.comments.current);
  const { articleElements: elements } = snapshot;
  refs.persistence.current = snapshot;
  const structured = refs.onDocumentChange?.current;
  const markdownChanged = structured ? true : snapshot.markdown !== refs.lastMarkdown.current;
  if (structured && snapshot.document) structured(snapshot.document);
  else if (markdownChanged) {
    refs.lastMarkdown.current = snapshot.markdown;
    refs.onChange.current(snapshot.markdown);
  }
  if (articleElementsEnabled && (markdownChanged || identityChanged)) {
    refs.callbacks.current.onArticleElementsChange?.(elements, markdownChanged ? 'document' : 'identity');
  }
  const location = articleElementsEnabled ? captureArticleEditorLocation(editor) : null;
  if (!location) return;
  refs.callbacks.current.onArticleLocationChange?.(location);
  if (markdownChanged) refs.callbacks.current.onArticleEditLocation?.(location);
}
