import type { Editor } from '@tiptap/core';
import type { ArticleEditorLocationDto, ArticleElementPlacementInput } from '@/shared/contracts';
import { normalizeMarkdownForWysiwyg } from '@/renderer/features/video-documents/markdownForWysiwyg';
import {
  articleElementPlacements,
  captureArticleEditorLocation,
} from '@/renderer/features/video-documents/articleElementIdentity';

export interface VideoDocumentWysiwygPersistenceSnapshot {
  markdown: string;
  articleElements: ArticleElementPlacementInput[];
}

export type VideoDocumentArticleElementsChangeReason = 'hydrate' | 'document' | 'identity';

interface PublicationRefs {
  persistence: { current: VideoDocumentWysiwygPersistenceSnapshot };
  lastMarkdown: { current: string };
  onChange: { current(markdown: string): void };
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

export function publishVideoDocumentEditor(
  editor: Editor,
  identityChanged: boolean,
  articleElementsEnabled: boolean,
  refs: PublicationRefs,
) {
  if (editor.isDestroyed) return;
  const markdown = normalizeMarkdownForWysiwyg(editor.getMarkdown());
  const elements = articleElementsEnabled ? articleElementPlacements(editor) : [];
  refs.persistence.current = { markdown, articleElements: elements.map((element) => ({ ...element })) };
  const markdownChanged = markdown !== refs.lastMarkdown.current;
  if (markdownChanged) {
    refs.lastMarkdown.current = markdown;
    refs.onChange.current(markdown);
  }
  if (articleElementsEnabled && (markdownChanged || identityChanged)) {
    refs.callbacks.current.onArticleElementsChange?.(elements, markdownChanged ? 'document' : 'identity');
  }
  const location = articleElementsEnabled ? captureArticleEditorLocation(editor) : null;
  if (!location) return;
  refs.callbacks.current.onArticleLocationChange?.(location);
  if (markdownChanged) refs.callbacks.current.onArticleEditLocation?.(location);
}
