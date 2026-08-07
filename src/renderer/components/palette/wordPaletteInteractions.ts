export const WORD_PALETTE_TERM_DRAG_TYPE = 'application/x-aiy-word-palette-term';
export const WORD_PALETTE_RECIPE_DRAG_TYPE = 'application/x-aiy-word-palette-recipe';

export interface WordPaletteTermDragPayload {
  termId: string;
  origin: 'dictionary' | 'editor';
  nodeKey?: string;
  plainText: string;
}

let activeTermDrag: WordPaletteTermDragPayload | null = null;

export interface WordPaletteRecipeDragPayload {
  paletteId: string;
  origin: 'dictionary' | 'editor';
  nodeKey?: string;
  plainText: string;
}

let activeRecipeDrag: WordPaletteRecipeDragPayload | null = null;

export function writeWordPaletteTermDrag(dataTransfer: DataTransfer, payload: WordPaletteTermDragPayload) {
  activeTermDrag = payload;
  // A term can be moved to a new Prompt position or linked with another term
  // as a choice. Allow the active drop target to communicate either result.
  dataTransfer.effectAllowed = 'all';
  dataTransfer.setData(WORD_PALETTE_TERM_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.plainText);
}

export function activeWordPaletteTermDrag() {
  return activeTermDrag;
}

export function clearWordPaletteTermDrag() {
  activeTermDrag = null;
}

export function readWordPaletteTermDrag(dataTransfer: DataTransfer) {
  const value = dataTransfer.getData(WORD_PALETTE_TERM_DRAG_TYPE).trim();
  if (!value) {
    // During dragover Chromium protects custom payload values, but keeps the
    // MIME type visible. Only fall back to the active session for our own drag
    // so an interrupted drag cannot turn a later file/text drop into a term.
    return Array.from(dataTransfer.types).includes(WORD_PALETTE_TERM_DRAG_TYPE) ? activeTermDrag : null;
  }
  try {
    const payload = JSON.parse(value) as Partial<WordPaletteTermDragPayload>;
    if (
      typeof payload.termId !== 'string' ||
      !payload.termId.trim() ||
      (payload.origin !== 'dictionary' && payload.origin !== 'editor')
    )
      return null;
    return {
      termId: payload.termId.trim(),
      origin: payload.origin,
      ...(typeof payload.nodeKey === 'string' && payload.nodeKey ? { nodeKey: payload.nodeKey } : {}),
      plainText: typeof payload.plainText === 'string' ? payload.plainText : '',
    } satisfies WordPaletteTermDragPayload;
  } catch {
    return null;
  }
}

export function writeWordPaletteRecipeDrag(dataTransfer: DataTransfer, payload: WordPaletteRecipeDragPayload) {
  activeRecipeDrag = payload;
  dataTransfer.effectAllowed = 'all';
  dataTransfer.setData(WORD_PALETTE_RECIPE_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.plainText);
}

export function activeWordPaletteRecipeDrag() {
  return activeRecipeDrag;
}

export function clearWordPaletteRecipeDrag() {
  activeRecipeDrag = null;
}

export function readWordPaletteRecipeDrag(dataTransfer: DataTransfer) {
  const value = dataTransfer.getData(WORD_PALETTE_RECIPE_DRAG_TYPE).trim();
  if (!value) {
    return Array.from(dataTransfer.types).includes(WORD_PALETTE_RECIPE_DRAG_TYPE) ? activeRecipeDrag : null;
  }
  try {
    const payload = JSON.parse(value) as Partial<WordPaletteRecipeDragPayload>;
    if (
      typeof payload.paletteId !== 'string' ||
      !payload.paletteId.trim() ||
      (payload.origin !== 'dictionary' && payload.origin !== 'editor')
    )
      return null;
    return {
      paletteId: payload.paletteId.trim(),
      origin: payload.origin,
      ...(typeof payload.nodeKey === 'string' && payload.nodeKey ? { nodeKey: payload.nodeKey } : {}),
      plainText: typeof payload.plainText === 'string' ? payload.plainText : '',
    } satisfies WordPaletteRecipeDragPayload;
  } catch {
    return { paletteId: value, origin: 'dictionary', plainText: '' } satisfies WordPaletteRecipeDragPayload;
  }
}
