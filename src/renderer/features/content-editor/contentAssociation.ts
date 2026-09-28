import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { bracketAssociationsEnabled } from '@/renderer/features/content-editor/contentAssociationPreferences';
import { activeOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { insertOutlineContentLink, outlineLinkItem } from '@/renderer/features/content-editor/outlineContentLink';

export interface ContentAssociationRequest {
  mode: 'AUTO' | 'MANUAL';
  from: number;
  to: number;
  query: string;
  view: EditorView;
  blockId?: string;
  composing?: boolean;
}

export const contentAssociationKey = new PluginKey<ContentAssociationRequest | null>('contentAssociation');
export const contentAssociationFocusEvent = 'aiy:focus-content-association';

export function canAssociateSelection(selection: Selection) {
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to)) return false;
  if (selection.$from.parent.type.spec.code) return false;
  return !selection.$from.marks().some((mark) => mark.type.spec.code);
}

function textSelection(state: Pick<EditorState, 'selection'>) {
  return (
    canAssociateSelection(state.selection) && !state.selection.$from.marks().some((mark) => mark.type.name === 'link')
  );
}

function automaticRequest(
  state: Pick<EditorState, 'selection' | 'doc'>,
  view: EditorView,
  from: number,
): ContentAssociationRequest | null {
  const { selection, doc } = state;
  if (!textSelection(state) || !selection.empty || from < selection.$from.start() || from >= selection.from)
    return null;
  const text = doc.textBetween(from, selection.from, '\n', '\ufffc');
  const match = /^[\[【]+([^\[\]【】\n\ufffc]*)$/u.exec(text);
  if (!match || match[1].length > 200) return null;
  return { mode: 'AUTO', from, to: selection.from, query: match[1], view };
}

/** Explicit actions work even when automatic suggestions are disabled. */
export function openContentAssociation(editor: Editor, options: { blockId?: string; selection?: Selection } = {}) {
  const view = activeOutlineView(editor);
  if (editor.isDestroyed || !editor.isEditable || view.composing) return false;
  const saved = options.selection;
  const selection = saved?.$from.doc === editor.state.doc ? saved : editor.state.selection;
  const selectedText = selection instanceof TextSelection && !selection.empty;
  const item = options.blockId ? outlineLinkItem(editor, options.blockId) : null;
  if (options.blockId && !item) return false;
  const belongs = item && selection.from >= item.position + 1 && selection.to < item.position + item.node.nodeSize;
  const useSelection = selectedText && (!item || belongs);
  const position = item && !useSelection ? item.position + 2 : selection.from;
  const transaction = editor.state.tr.setSelection(
    useSelection ? selection : TextSelection.near(editor.state.doc.resolve(position)),
  );
  if (!canAssociateSelection(transaction.selection)) return false;
  const pending: ContentAssociationRequest = {
    mode: 'MANUAL',
    from: transaction.selection.from,
    to: transaction.selection.to,
    query: useSelection ? editor.state.doc.textBetween(selection.from, selection.to, ' ').slice(0, 200) : '',
    view,
    blockId: item && !useSelection ? options.blockId : undefined,
  };
  view.dispatch(transaction.setMeta(contentAssociationKey, pending).setMeta('addToHistory', false));
  return true;
}

export function dismissContentAssociation(editor: Editor) {
  if (!editor.isDestroyed && contentAssociationKey.getState(editor.state))
    editor.view.dispatch(editor.state.tr.setMeta(contentAssociationKey, null).setMeta('addToHistory', false));
}

export function insertContentAssociation(
  editor: Editor,
  request: ContentAssociationRequest,
  href: string,
  title: string,
) {
  if (
    editor.isDestroyed ||
    !editor.isEditable ||
    request.view.isDestroyed ||
    request.view.composing ||
    contentAssociationKey.getState(editor.state) !== request ||
    !editor.schema.marks.link
  )
    return false;
  rememberOutlineView(editor, request.view);
  if (request.blockId) {
    const inserted = insertOutlineContentLink(editor, request.blockId, href, title);
    if (inserted) dismissContentAssociation(editor);
    return inserted;
  }
  const mark = editor.schema.marks.link.create({ href });
  const transaction = closeHistory(editor.state.tr);
  if (request.mode === 'MANUAL' && request.from !== request.to) {
    transaction.addMark(request.from, request.to, mark);
    transaction.setSelection(TextSelection.create(transaction.doc, request.to));
  } else {
    transaction.replaceWith(request.from, request.to, editor.schema.text(title || href, [mark]));
    transaction.setSelection(TextSelection.create(transaction.doc, request.from + (title || href).length));
  }
  transaction.removeStoredMark(editor.schema.marks.link);
  request.view.dispatch(
    transaction.setMeta(contentAssociationKey, null).setMeta('preventAutolink', true).scrollIntoView(),
  );
  request.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  request.view.focus();
  return true;
}

export function createContentAssociationExtension(available: () => boolean) {
  return Extension.create({
    name: 'contentAssociation',
    priority: 1_200,
    addProseMirrorPlugins() {
      const editor = this.editor;
      let composition: { view: EditorView; from: number; document: EditorState['doc'] } | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      return [
        new Plugin<ContentAssociationRequest | null>({
          key: contentAssociationKey,
          state: {
            init: () => null,
            apply(transaction, previous, _old, next) {
              const meta = transaction.getMeta(contentAssociationKey) as ContentAssociationRequest | null | undefined;
              if (meta !== undefined) return meta;
              if (!previous) return null;
              if (
                !available() ||
                transaction.getMeta('uiEvent') === 'paste' ||
                transaction.getMeta('uiEvent') === 'drop'
              )
                return null;
              if (previous.mode === 'MANUAL')
                return transaction.docChanged || transaction.selectionSet ? null : previous;
              if (!bracketAssociationsEnabled()) return null;
              if (transaction.docChanged) {
                const from = transaction.mapping.map(previous.from, -1);
                const pending = automaticRequest(next, previous.view, from);
                return pending ? { ...pending, composing: previous.composing } : null;
              }
              if (transaction.selectionSet && (next.selection.from !== previous.to || !next.selection.empty))
                return null;
              return previous;
            },
          },
          props: {
            handleTextInput(view, from, to, text, deflt) {
              if (
                !available() ||
                !bracketAssociationsEnabled() ||
                !editor.isEditable ||
                view.composing ||
                !textSelection(view.state)
              )
                return false;
              const previous = contentAssociationKey.getState(view.state);
              const opening = text.search(/[\[【]/u);
              if (previous?.mode !== 'AUTO' && opening < 0) return false;
              // Closing brackets must still reach Markdown and other normal input rules.
              if (/[\]】\n]/u.test(text)) return false;
              const transaction = deflt();
              const start = previous?.mode === 'AUTO' ? previous.from : from + opening;
              const request = automaticRequest(transaction, view, start);
              rememberOutlineView(editor, view);
              view.dispatch(transaction.setMeta(contentAssociationKey, request));
              return true;
            },
            handleKeyDown(view, event) {
              if (view.composing || event.isComposing) return false;
              const pending = contentAssociationKey.getState(view.state);
              if (!pending || pending.view !== view) return false;
              if (event.key === 'Escape') {
                composition = null;
                dismissContentAssociation(editor);
                return true;
              }
              if (event.key === 'ArrowDown' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                return !view.dom.dispatchEvent(new Event(contentAssociationFocusEvent, { cancelable: true }));
              }
              return false;
            },
            handleDOMEvents: {
              compositionstart(view) {
                clearTimeout(timer);
                if (!available() || !bracketAssociationsEnabled() || !editor.isEditable || !textSelection(view.state))
                  return false;
                composition = { view, from: view.state.selection.from, document: view.state.doc };
                const pending = contentAssociationKey.getState(view.state);
                if (pending)
                  view.dispatch(view.state.tr.setMeta(contentAssociationKey, { ...pending, composing: true }));
                return false;
              },
              compositionend(view) {
                const started = composition;
                timer = setTimeout(() => {
                  if (
                    !started ||
                    composition !== started ||
                    started.view !== view ||
                    view.isDestroyed ||
                    view.composing ||
                    !available() ||
                    !bracketAssociationsEnabled() ||
                    !view.hasFocus()
                  )
                    return;
                  composition = null;
                  const previous = contentAssociationKey.getState(view.state);
                  let from = previous?.mode === 'AUTO' ? previous.from : -1;
                  if (from < 0 && started.document !== view.state.doc && started.from <= view.state.selection.from) {
                    const text = view.state.doc.textBetween(started.from, view.state.selection.from, '\n');
                    const opening = text.search(/[\[【]/u);
                    if (opening >= 0) from = started.from + opening;
                  }
                  const pending = from >= 0 ? automaticRequest(view.state, view, from) : null;
                  view.dispatch(view.state.tr.setMeta(contentAssociationKey, pending).setMeta('addToHistory', false));
                }, 32);
                return false;
              },
              paste() {
                composition = null;
                dismissContentAssociation(editor);
                return false;
              },
              pointerdown(view) {
                rememberOutlineView(editor, view);
                composition = null;
                dismissContentAssociation(editor);
                return false;
              },
              focus(view) {
                rememberOutlineView(editor, view);
                return false;
              },
            },
          },
          view: () => ({
            destroy() {
              clearTimeout(timer);
              composition = null;
            },
          }),
        }),
      ];
    },
  });
}
