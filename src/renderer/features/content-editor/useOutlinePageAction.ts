import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { announceArticleCreated } from '@/renderer/features/content-editor/articleCreated';
import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { outlineViewState, setOutlineView } from '@/renderer/features/content-editor/outlineViewState';
import { outlineSelectionRoots } from '@/shared/outline-move';
import type { OutlinePageCreateInput } from '@/shared/contracts/outline-page';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { useI18n } from '@/renderer/i18n/useI18n';

function createPageActionState() {
  let busy = false;
  const listeners = new Set<() => void>();
  return {
    pending: null as OutlinePageCreateInput | null,
    get: () => busy,
    set(next: boolean) {
      busy = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const states = new WeakMap<Editor, ReturnType<typeof createPageActionState>>();
function stateFor(editor: Editor) {
  let state = states.get(editor);
  if (!state) {
    state = createPageActionState();
    states.set(editor, state);
  }
  return state;
}

function pageFailure(reason: unknown, copy: ReturnType<typeof useI18n>['messages']['referenceOutline']) {
  const message = String(reason);
  if (message.includes('OUTLINE_LINK_SOURCE_CHANGED')) return copy.pageChanged;
  return referenceFailure(reason, copy, copy.pageFailed);
}

export function useOutlinePageAction(editor: Editor) {
  const host = useContentReferenceHost();
  const linkHost = useOutlineContentLinkHost();
  const navigate = useReferenceNavigation();
  const copy = useI18n().messages.referenceOutline;
  const state = stateFor(editor);
  const busy = useSyncExternalStore(state.subscribe, state.get, state.get);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const supported = Boolean(
    linkHost && host.outline && host.beforeCapture && host.onTransferSaved && !host.sharedEditor,
  );

  const create = async (ids: readonly string[]) => {
    if (
      !supported ||
      !linkHost ||
      state.get() ||
      editor.isDestroyed ||
      !editor.isEditable ||
      activeOutlineView(editor).composing
    )
      return false;
    const document = editor.state.doc;
    const roots = outlineSelectionRoots(document.toJSON(), ids);
    const view = outlineViewState(editor.state);
    if (!roots.length || roots.length > 200 || roots.includes(view.focus ?? '')) return false;
    state.set(true);
    editor.setEditable(false, false);
    try {
      const saved = await host.beforeCapture!();
      if (!saved?.revisionId || saved.kind !== 'ARTICLE' || saved.id !== linkHost.articleId)
        throw new Error('REFERENCE_SAVE_FAILED');
      if (!mounted.current || editor.isDestroyed || !editor.state.doc.eq(document))
        throw new Error('REFERENCE_TARGET_CHANGED');
      if (state.pending && JSON.stringify(state.pending.selectedIds) !== JSON.stringify(roots)) state.pending = null;
      state.pending ??= {
        spaceId: linkHost.spaceId,
        requestId: crypto.randomUUID(),
        sourceArticleId: saved.id,
        expectedRevisionId: saved.revisionId,
        selectedIds: roots,
        untitledTitle: copy.untitledOutline,
      };
      const result = await contentLibraryApi().outlinePageCreate(state.pending);
      state.pending = null;
      announceArticleCreated({
        spaceId: result.link.spaceId,
        article: result.page,
        creationItem: result.creationItem,
      });
      try {
        if (mounted.current && !editor.isDestroyed) {
          setOutlineView(editor, { ...outlineViewState(editor.state), selected: [], anchor: null, active: null });
          // Navigate before adopting the saved source: adopting it can remount this
          // editor, which correctly cancels navigation requests from an old view.
          await navigate({ source: { kind: 'ARTICLE', id: result.link.target.id } }, { placement: 'beside' });
        }
      } catch {
        linkHost.notify?.(copy.pageOpenFailed);
      } finally {
        host.onTransferSaved!(result.source);
      }
      return true;
    } catch (reason) {
      const message = String(reason);
      if (message.includes('OUTLINE_LINK_SOURCE_CHANGED')) state.pending = null;
      linkHost.notify?.(pageFailure(reason, copy));
      return false;
    } finally {
      if (!editor.isDestroyed) {
        editor.setEditable(true, false);
        editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
      }
      state.set(false);
    }
  };
  return { busy, supported, create };
}
