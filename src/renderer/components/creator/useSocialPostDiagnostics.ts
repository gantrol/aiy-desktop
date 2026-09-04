import { useEffect, useId, useRef } from 'react';
import type { SocialPostContentInput, SocialPostDto } from '@/shared/contracts';
import type { RendererDiagnosticDetails, RendererDiagnosticInput } from '@/shared/contracts/renderer-diagnostics';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';
import { recordRendererDiagnostic } from '@/renderer/lib/rendererDiagnostics';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  post: SocialPostDto;
  content: SocialPostContentInput;
  dirty: boolean;
  saving: boolean;
  saveFailed: boolean;
}

function contentMetrics(content: SocialPostContentInput) {
  return {
    bodyLength: content.body.length,
    titleLength: content.title.length,
    imageCount: content.mediaAssetIds.length,
  };
}

/** Diagnostic counters only; never owns or replays editor content. */
export function useSocialPostDiagnostics({ post, content, dirty, saving, saveFailed }: Options) {
  const sessionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const counters = useRef({
    draftSequence: 0,
    inputCount: 0,
    keyCount: 0,
    changeCount: 0,
    focused: false,
    composing: false,
  });
  const saveSequence = useRef(0);
  const record = useStableCallback((event: RendererDiagnosticInput['event'], extra: RendererDiagnosticDetails = {}) => {
    recordRendererDiagnostic(event, {
      sessionId,
      postId: post.id,
      revisionNo: post.revisionNo,
      ...contentMetrics(content),
      ...counters.current,
      dirty,
      saving,
      saveFailed,
      ...extra,
    });
  });

  useEffect(() => {
    record('post-mount');
    return () => record('post-unmount');
  }, [record]);
  useEffect(() => {
    counters.current.draftSequence += 1;
    record('post-state');
  }, [content, record]);
  useEffect(() => {
    record('post-status');
  }, [dirty, record, saveFailed, saving]);
  useEffect(() => {
    record('post-props', { revisionNo: post.revisionNo, ...contentMetrics(post.content) });
  }, [post, record]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isTextField = (event: Event) =>
      event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    const input = (event: Event) => {
      if (!isTextField(event)) return;
      if (event.type === 'input') counters.current.inputCount += 1;
      else counters.current.keyCount += 1;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        record('post-input');
      }, 250);
    };
    const focus = (event: FocusEvent) => {
      if (!isTextField(event)) return;
      counters.current.focused = event.type === 'focusin';
      record(counters.current.focused ? 'post-focus' : 'post-blur');
    };
    const composition = (event: CompositionEvent) => {
      if (!isTextField(event)) return;
      counters.current.composing = event.type === 'compositionstart';
      record(counters.current.composing ? 'post-composition-start' : 'post-composition-end');
    };
    root.addEventListener('input', input);
    root.addEventListener('keydown', input);
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', focus);
    root.addEventListener('compositionstart', composition);
    root.addEventListener('compositionend', composition);
    return () => {
      clearTimeout(timer);
      root.removeEventListener('input', input);
      root.removeEventListener('keydown', input);
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', focus);
      root.removeEventListener('compositionstart', composition);
      root.removeEventListener('compositionend', composition);
    };
  }, [record]);

  const beginSave = useStableCallback((snapshot: SocialPostContentInput) => {
    const start = performance.now();
    const captured = {
      sessionId,
      postId: post.id,
      draftSequence: counters.current.draftSequence,
      ...contentMetrics(snapshot),
    };
    const requestId = `${sessionId}:${++saveSequence.current}`;
    record('post-save-start', { ...captured, requestId });
    return {
      success: (revisionNo: number) =>
        record('post-save-success', {
          ...captured,
          requestId,
          durationMs: performance.now() - start,
          revisionNo,
        }),
      failure: (error: unknown) =>
        record('post-save-failure', {
          ...captured,
          requestId,
          durationMs: performance.now() - start,
          error: rendererDiagnosticError(error),
        }),
    };
  });

  return {
    rootRef,
    beginSave,
    noteChange: () => {
      counters.current.changeCount += 1;
    },
    skippedSave: (matchesSaved: boolean) => record('post-save-skipped', { matchesSaved }),
  };
}
