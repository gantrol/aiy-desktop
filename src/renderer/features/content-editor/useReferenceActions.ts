import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { currentReferenceTarget } from '@/renderer/features/content-editor/ContentReferencePicker';
import { copyContentReference } from '@/renderer/features/content-editor/contentReferenceClipboard';
import { referenceParentHeading } from '@/renderer/features/content-editor/referenceParentHeading';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import type { WorkspaceReferencePlacement } from '@/renderer/components/workspace/workspace-state';
import type { ContentReference, ResolvedContentReference } from '@/shared/contracts/content-library';
import { referenceEditableDocument } from '@/shared/content-reference-document';
import { referenceLinkUrl } from '@/shared/content-reference-link';
import {
  followingPresentation,
  type ReferenceEditing,
  type ReferencePresentation,
} from '@/shared/content-reference-token';
import { referenceFailure } from '@/shared/i18n/reference-outline';

export type ReferenceMode = 'LINK' | 'FOLLOW' | 'SYNC' | 'FIXED';
export interface ReferenceActionsProps extends Pick<NodeViewProps, 'editor' | 'getPos' | 'node'> {
  reference: ContentReference;
  resolution: ResolvedContentReference;
  presentation?: ReferencePresentation;
  editing: ReferenceEditing;
  adopt(reference: ContentReference): void;
}

export function useReferenceActions(props: ReferenceActionsProps) {
  const { editor, getPos, node, reference, resolution, presentation, editing, adopt } = props;
  const labels = useI18n().messages.referenceOutline;
  const host = useContentReferenceHost();
  const sessions = useArticleEditorSessions();
  const navigate = useReferenceNavigation(String(node.attrs.blockId ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const epoch = useRef(0);
  const cancel = useCallback(() => {
    epoch.current++;
  }, []);
  useEffect(() => {
    const disconnect = window.desktopApi?.onLocalSpaceTransition?.(cancel);
    return () => {
      cancel();
      disconnect?.();
    };
  }, [reference.id, cancel]);
  const mode: ReferenceMode =
    presentation?.display === 'LINK'
      ? 'LINK'
      : resolution.mode === 'FIXED'
        ? 'FIXED'
        : editing === 'SOURCE'
          ? 'SYNC'
          : 'FOLLOW';
  const selector = reference.selector?.kind === 'BLOCK' ? reference.selector : undefined;
  const target = currentReferenceTarget(reference.source, selector?.blockId, selector?.section, selector?.scope);
  const canFollow =
    target.source.kind === 'ARTICLE' &&
    Boolean(reference.selector) &&
    reference.selector?.kind !== 'MEMBERS' &&
    !(host.source?.kind === 'ARTICLE' && host.source.id === reference.source.id && !selector);
  const canSync = canFollow && Boolean(sessions) && !host.sharedEditor;
  const link = referenceLinkUrl(reference);
  const currentPosition = (writable = true) => {
    const position = getPos();
    if (
      editor.isDestroyed ||
      (writable && !editor.isEditable) ||
      editor.view.composing ||
      position === undefined ||
      !editor.state.doc.nodeAt(position)?.eq(node)
    )
      throw new Error('REFERENCE_TARGET_CHANGED');
    return position;
  };
  const run = async (operation: (assertCurrent: () => void) => Promise<void>, writable = true) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const generation = epoch.current;
    const assertCurrent = () => {
      if (generation !== epoch.current) throw new Error('REFERENCE_TARGET_CHANGED');
      currentPosition(writable);
    };
    try {
      assertCurrent();
      await operation(assertCurrent);
    } catch (reason) {
      if (generation === epoch.current) setError(referenceFailure(reason, labels));
    } finally {
      pending.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  };
  const flushSource = async () => {
    const session = reference.spaceId ? sessions?.find(reference.spaceId, reference.source.id) : undefined;
    if (session && !(await session.flush('manual'))) throw new Error('REFERENCE_SAVE_FAILED');
    if (session?.getRecoveryPending()) throw new Error('REFERENCE_TARGET_CHANGED');
  };
  const savedReference = async () => {
    if (resolution.mode !== 'FOLLOW' || resolution.state !== 'CURRENT') return reference;
    await flushSource();
    const [current] = await contentLibraryApi().referenceResolve([reference.id]);
    if (!current || current.state !== 'CURRENT' || current.reference.spaceId !== reference.spaceId)
      throw new Error('REFERENCE_TARGET_CHANGED');
    return current.reference;
  };
  const update = (attrs: Record<string, unknown>) => {
    const transaction = closeHistory(editor.state.tr).setNodeMarkup(currentPosition(), undefined, {
      ...node.attrs,
      ...attrs,
    });
    editor.view.dispatch(transaction);
  };
  const changeMode = (nextMode: ReferenceMode) =>
    run(async (assertCurrent) => {
      if (nextMode === mode) return;
      if ((nextMode === 'FOLLOW' && !canFollow) || (nextMode === 'SYNC' && !canSync))
        throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
      if (nextMode === 'LINK' && !link) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      let next = await savedReference();
      assertCurrent();
      const api = contentLibraryApi();
      if (nextMode === 'FIXED' || nextMode === 'LINK') {
        if (resolution.mode === 'FOLLOW') next = await api.referenceFreeze(next.id, next.revisionId, next.contentHash);
      } else if (resolution.mode !== 'FOLLOW') {
        await flushSource();
        assertCurrent();
        const preview = await api.referenceInspect(target);
        assertCurrent();
        if (preview.spaceId !== reference.spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
        next = await api.referenceFollow(preview.target, preview.version);
      } else if (resolution.state !== 'CURRENT') throw new Error('REFERENCE_FOLLOW_UNAVAILABLE');
      assertCurrent();
      update({
        referenceId: next.id,
        referenceSpaceId: next.spaceId ?? null,
        referenceEditing: nextMode === 'SYNC' ? 'SOURCE' : 'READ_ONLY',
        referencePresentation: {
          ...(presentation ?? followingPresentation),
          display: nextMode === 'LINK' ? 'LINK' : presentation?.display === 'QUOTE' ? 'QUOTE' : 'BODY',
        },
      });
    });
  const convert = () =>
    run(async (assertCurrent) => {
      const saved = await savedReference();
      assertCurrent();
      const position = currentPosition();
      const document = referenceEditableDocument(
        saved,
        presentation?.display === 'LINK' ? { ...presentation, display: 'BODY' } : presentation,
        referenceParentHeading(editor.state.doc, position),
      );
      const nodes = document.root.content ?? [];
      nodes.forEach((child) => editor.schema.nodeFromJSON(child).check());
      adopt(saved);
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          closeHistory(tr);
          return true;
        })
        .insertContentAt({ from: position, to: position + node.nodeSize }, nodes)
        .run();
    });
  const copy = (format: 'REFERENCE' | 'TEXT') =>
    run(async (assertCurrent) => {
      const saved = await savedReference();
      assertCurrent();
      await copyContentReference(saved, format, {
        presentation,
        editing,
        parentLevel: referenceParentHeading(editor.state.doc, currentPosition(false)),
      });
    }, false);
  const openSource = (placement: WorkspaceReferencePlacement = 'tab') =>
    run(async (assertCurrent) => {
      if (mode === 'SYNC') await flushSource();
      assertCurrent();
      if (reference.source.kind === 'ALBUM' && link) await contentLibraryApi().linkOpen(link);
      else await navigate(target, { placement });
    }, false);
  const replace = (next: ContentReference) => {
    currentPosition();
    update({ referenceId: next.id, referenceSpaceId: next.spaceId ?? null });
  };
  const changePresentation = (value: ReferencePresentation) =>
    run(async (assertCurrent) => {
      if (mode === 'SYNC') await flushSource();
      assertCurrent();
      update({ referencePresentation: value });
    });
  return {
    mode,
    busy,
    error,
    canFollow,
    canSync,
    link,
    target,
    changeMode,
    convert,
    copy,
    openSource,
    replace,
    changePresentation,
    flushSource,
  };
}
