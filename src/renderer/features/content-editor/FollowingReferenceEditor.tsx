import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { LoaderCircle } from 'lucide-react';
import type { ContentReference } from '@/shared/contracts/content-library';
import { captureBlockDocument, type BlockDocument } from '@/shared/contracts/block-document';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { useFollowingSource } from '@/renderer/features/content-editor/useFollowingSource';
import {
  referenceDocumentSelection,
  replaceReferenceDocument,
} from '@/renderer/features/content-editor/referenceDocumentEditing';
import { sharedDocumentTransaction } from '@/renderer/features/content-editor/sharedDocumentEdit';
import {
  DocumentImageMediaStore,
  createDocumentImageExtension,
} from '@/renderer/features/content-editor/contentImageExtension';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { useActiveContentEditor } from '@/renderer/features/content-editor/ActiveContentEditor';
import { ContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { useVideoDocumentEditorComposition } from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import {
  referenceEditingPresentation,
  unprojectReferenceEdit,
} from '@/renderer/features/content-editor/referenceEditingPresentation';
import { referenceEditGuard } from '@/renderer/features/content-editor/referenceEditGuard';
import {
  OutlineBulletList,
  OutlineOrderedList,
  OutlineTaskList,
} from '@/renderer/features/content-editor/OutlineListRoles';
import { ContentInputOperations } from '@/renderer/features/content-editor/contentInputOperations';
import { registerContentImageRecovery } from '@/renderer/features/content-editor/contentImageRecovery';
import { ContentLinkSource } from '@/renderer/features/content-editor/ContentLinkProviders';

export function FollowingReferenceEditor({
  reference,
  presentation,
  parentLevel,
}: {
  reference: ContentReference;
  presentation?: ReferencePresentation;
  parentLevel: number;
}) {
  const copy = useI18n().messages.referenceOutline;
  const { runtime, failure, revision } = useFollowingSource(reference);
  const { activate } = useActiveContentEditor();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [shownTitle, setShownTitle] = useState<{ level: number; text: string }>();
  const [inputs] = useState(() => new ContentInputOperations());
  const offset = useRef(0);
  const before = useRef<BlockDocument | null>(null);
  const updating = useRef(false);
  const blocked = useRef(false);
  const publishRef = useRef((_settled = false) => undefined as void);
  const validateRef = useRef<(transaction: Transaction) => boolean>(() => true);
  const editorRef = useRef<Editor | null>(null);
  const compositionPublish = useRef(() => publishRef.current(true));
  const composition = useVideoDocumentEditorComposition({ editor: editorRef, publish: compositionPublish });
  const media = useMemo(() => new DocumentImageMediaStore({ media: [], mediaBindings: [] }), []);
  const extensions = useMemo(
    () => [
      createDocumentImageExtension(media),
      OutlineBulletList,
      OutlineOrderedList,
      OutlineTaskList,
      referenceEditGuard((transaction) => validateRef.current(transaction)),
    ],
    [media],
  );
  const editor = useContentEditor({
    content: reference.document?.root ?? markdownBlockDocument(reference.markdown, reference.media).root,
    editable: false,
    extensions,
    presentation: { typography: 'article', ariaLabel: copy.sharedContent, className: 'min-h-6 outline-none' },
    onUpdate: ({ editor: current, transaction }) => {
      if (!composition.defers(current, transaction)) publishRef.current();
    },
    onFocus: ({ editor: current }) => {
      if (runtime) activate({ editor: current, session: runtime, inputs });
    },
    editorProps: {
      handleDOMEvents: {
        compositionstart: composition.start,
        compositionend: composition.end,
        blur: () => {
          publishRef.current();
          void runtime?.flush();
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          publishRef.current();
          void runtime?.flush('manual');
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;
  validateRef.current = (transaction) => {
    if (updating.current || !editor || !runtime || !before.current || editor.view.composing) return true;
    try {
      const snapshot = runtime.captureSnapshot();
      if (runtime.getRecoveryPending() || runtime.model.getSnapshot().editorPending)
        throw new Error('REFERENCE_TARGET_CHANGED');
      const document = snapshot.document ?? markdownBlockDocument(snapshot.markdown, snapshot.mediaBindings);
      replaceReferenceDocument(
        document,
        reference.selector,
        before.current,
        unprojectReferenceEdit(captureBlockDocument(transaction.doc.toJSON()), offset.current),
        snapshot.editorMode === 'OUTLINE',
        editor.schema,
      );
      return true;
    } catch (reason) {
      queueMicrotask(() => setError(referenceFailure(reason, copy)));
      return false;
    }
  };
  publishRef.current = (settled = false) => {
    if (
      !editor ||
      !runtime ||
      updating.current ||
      (!settled && editor.view.composing) ||
      blocked.current ||
      !before.current
    )
      return;
    try {
      const snapshot = runtime.captureSnapshot();
      const document = snapshot.document ?? markdownBlockDocument(snapshot.markdown, snapshot.mediaBindings);
      const changed = unprojectReferenceEdit(captureBlockDocument(editor.getJSON()), offset.current);
      const next = replaceReferenceDocument(
        document,
        reference.selector,
        before.current,
        changed,
        snapshot.editorMode === 'OUTLINE',
        editor.schema,
      );
      updating.current = true;
      if (!runtime.editSharedDocument(document, next, editor.schema)) throw new Error('REFERENCE_TARGET_CHANGED');
      before.current = referenceDocumentSelection(next, reference.selector, snapshot.editorMode === 'OUTLINE');
      setError('');
    } catch (reason) {
      blocked.current = true;
      setError(referenceFailure(reason, copy));
    } finally {
      updating.current = false;
    }
  };
  useEffect(() => {
    if (!editor || !runtime || editor.isDestroyed) return;
    const state = runtime.model.getSnapshot();
    const ready = !runtime.getRecoveryPending() && !state.editorPending && !state.externalArticle;
    editor.setEditable(ready && !blocked.current, false);
    if (!ready || editor.view.composing || updating.current || blocked.current) return;
    try {
      const snapshot = runtime.captureSnapshot();
      media.update({
        media: state.draft.media,
        mediaBindings: snapshot.mediaBindings.map((binding) => ({
          ...binding,
          kind: 'IMAGE',
          timestampMs: null,
          endTimestampMs: null,
          posterAssetId: null,
        })),
      });
      const document = snapshot.document ?? markdownBlockDocument(snapshot.markdown, snapshot.mediaBindings);
      const selected = referenceDocumentSelection(document, reference.selector, snapshot.editorMode === 'OUTLINE');
      const projected = referenceEditingPresentation(selected, reference.title, presentation, parentLevel);
      offset.current = projected.offset;
      setShownTitle(
        projected.title ? { level: Number(projected.title.attrs?.level ?? 1), text: reference.title } : undefined,
      );
      const next = editor.schema.nodeFromJSON(projected.document.root);
      next.check();
      updating.current = true;
      before.current = selected;
      if (!editor.state.doc.eq(next)) editor.view.dispatch(sharedDocumentTransaction(editor.state.tr, next));
      setError('');
    } catch (reason) {
      setError(referenceFailure(reason, copy));
      editor.setEditable(false, false);
    } finally {
      updating.current = false;
    }
  }, [editor, runtime, revision, reference.selector, reference.title, media, copy, reload, presentation, parentLevel]);
  useEffect(
    () =>
      runtime?.registerSharedInput(async () => {
        if (!(await composition.whenSettled())) return false;
        await inputs.settle();
        return !blocked.current;
      }),
    [runtime, composition, inputs],
  );
  useEffect(() => {
    if (!editor || !runtime) return;
    return registerContentImageRecovery(editor, {
      imported: runtime.imageImported,
      failed: () => setError(copy.sharedSaveFailed),
      track: inputs.track,
    });
  }, [editor, runtime, inputs, copy.sharedSaveFailed]);
  useEffect(
    () => () => {
      activate((current) => (current?.editor === editor ? null : current));
    },
    [activate, editor],
  );
  const state = runtime?.model.getSnapshot();
  const saveFailed = state?.save.phase === 'failed' || state?.save.phase === 'conflict';
  return (
    <ContentReferenceHost.Provider
      value={{ source: reference.source.kind === 'ARTICLE' ? reference.source : undefined, sharedEditor: true }}
    >
      <ContentLinkSource.Provider value={reference.source.kind === 'ARTICLE' ? reference.source : undefined}>
        <div
          data-reference-editor
          className="min-w-0"
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => event.stopPropagation()}
        >
          {!runtime || runtime.recovery === 'loading' ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-label={copy.loadingShared} />
          ) : null}
          {shownTitle && createElement(`h${shownTitle.level}`, { className: 'font-semibold' }, shownTitle.text)}
          <EditorContent editor={editor} />
          {(error || failure || saveFailed) && (
            <span role="alert" className="text-xs text-destructive">
              {error || (failure ? referenceFailure(failure, copy) : copy.sharedSaveFailed)}
            </span>
          )}
          {saveFailed && (
            <Button variant="ghost" size="sm" onClick={() => void runtime?.retry()}>
              {copy.retry}
            </Button>
          )}
          {blocked.current && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                blocked.current = false;
                before.current = null;
                setError('');
                setReload((value) => value + 1);
              }}
            >
              {copy.discardSharedEdit}
            </Button>
          )}
          {runtime?.getRecoveryStatus() === 'restored' && (
            <Button variant="ghost" size="sm" onClick={() => runtime.adoptRecovery()}>
              {copy.restoreSharedDraft}
            </Button>
          )}
          {(state?.externalArticle || runtime?.recovery === 'conflict') && (
            <span role="status" className="text-xs text-warning">
              {copy.sharedConflict}
            </span>
          )}
        </div>
      </ContentLinkSource.Provider>
    </ContentReferenceHost.Provider>
  );
}
