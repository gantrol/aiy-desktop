/** Compatibility adapter for existing article and video editor consumers. */
export { ContentBlockEditor as VideoDocumentWysiwygEditor } from '@/renderer/features/content-editor/ContentBlockEditor';
export type {
  VideoDocumentWysiwygEditorLabels,
  VideoDocumentEditorImageImport,
  VideoDocumentArticleElementControls,
  VideoDocumentQuickInsertNoteRequest,
  VideoDocumentWysiwygEditorHandle,
  VideoDocumentWysiwygPersistenceSnapshot,
} from '@/renderer/features/content-editor/ContentBlockEditor';
