import type { Editor } from '@tiptap/core';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { activeArticleElementId } from '@/renderer/features/video-documents/articleElementIdentity';
import type { VideoDocumentWysiwygToolbarState } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';

function activeHeadingLevel(editor: Editor): 0 | 2 | 3 | 4 | 5 | 6 {
  if (editor.isActive('heading', { level: 2 })) return 2;
  if (editor.isActive('heading', { level: 3 })) return 3;
  if (editor.isActive('heading', { level: 4 })) return 4;
  if (editor.isActive('heading', { level: 5 })) return 5;
  if (editor.isActive('heading', { level: 6 })) return 6;
  return 0;
}

export const emptyToolbarState: VideoDocumentWysiwygToolbarState = {
  headingLevel: 0,
  bold: false,
  italic: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  link: false,
  codeBlock: false,
  blockquote: false,
  details: false,
  reveal: false,
  table: false,
  canUndo: false,
  canRedo: false,
  image: false,
  imageSourcePath: null,
  imageAltText: '',
  selectedText: '',
  articleElementId: null,
};

export function selectToolbarState(editor: Editor | null): VideoDocumentWysiwygToolbarState {
  if (!editor || editor.isDestroyed) return emptyToolbarState;
  const image = editor.isActive('image');
  const imageAttributes = image ? editor.getAttributes('image') : null;
  const { from, to } = editor.state.selection;
  return {
    headingLevel: activeHeadingLevel(editor),
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    link: editor.isActive('link'),
    codeBlock: editor.isActive('codeBlock'),
    blockquote: editor.isActive('blockquote'),
    details: editor.isActive('details'),
    reveal: editor.isActive('reveal'),
    table: editor.isActive('table'),
    canUndo: undoDepth(editor.state) > 0,
    canRedo: redoDepth(editor.state) > 0,
    image,
    imageSourcePath: typeof imageAttributes?.sourcePath === 'string' ? imageAttributes.sourcePath : null,
    imageAltText: typeof imageAttributes?.alt === 'string' ? imageAttributes.alt : '',
    selectedText: from === to ? '' : editor.state.doc.textBetween(from, to, '\n').trim(),
    articleElementId: activeArticleElementId(editor),
  };
}
