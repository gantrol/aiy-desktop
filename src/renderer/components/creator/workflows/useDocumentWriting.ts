import { useEffect, useRef, useState } from 'react';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type { CreatorAgentTurnDto } from '@/shared/contracts';
import type { DocumentWritingTask } from '@/shared/contracts/document-assistant';

export function useDocumentWriting(model: CreatorScreenViewModel, open: boolean, materialsImporting: boolean) {
  const labels = useI18n().messages.creator.documentWriting;
  const [kind, setKind] = useState<DocumentWritingTask['kind']>('draft');
  const [rewriteTask, setRewriteTask] = useState<DocumentWritingTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CreatorAgentTurnDto[]>([]);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const draftId = model.selection.creationDraftSession.draftId;
  const composer = model.generation.promptDocument.promptComposerRef;
  const isSessionCurrent = useStableCallback(
    (key: string) => mounted.current && model.generation.inputScopeKey === key,
  );
  const candidate = candidates.find((item) => item.id === candidateId) ?? candidates.at(-1) ?? null;
  const notifyFailure = useStableCallback((error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    model.app.notify(code === 'DOCUMENT_WRITING_SELECT_TEXT' ? labels.selectText : labels.failed);
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mergeCandidates = useStableCallback((items: CreatorAgentTurnDto[]) => {
    setCandidates((current) =>
      [...new Map([...items, ...current].map((item) => [item.id, item])).values()].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    );
  });
  const loadHistory = useStableCallback(async (nextCursor: string | null = null) => {
    if (!draftId || loading) return;
    const sessionKey = model.generation.inputScopeKey;
    setLoading(true);
    setHistoryFailed(false);
    const scope = { kind: 'DRAFT' as const, id: draftId };
    try {
      const page = await window.desktopApi.agentHistory({ scope, cursor: nextCursor, limit: 20 });
      if (!isSessionCurrent(sessionKey) || !model.draftInput.draftProjection.isScopeCurrent(scope)) return;
      mergeCandidates(page.items.filter((item) => item.documentTask));
      setCursor(page.nextCursor);
    } catch {
      if (isSessionCurrent(sessionKey)) setHistoryFailed(true);
    } finally {
      if (isSessionCurrent(sessionKey)) setLoading(false);
    }
  });
  useEffect(() => {
    if (open && model.app.active) void loadHistory();
  }, [draftId, open, model.app.active, loadHistory]);

  const chooseKind = useStableCallback((next: DocumentWritingTask['kind']) => {
    try {
      const selected = next === 'rewrite' ? composer.current?.captureWritingTask(next) : null;
      if (next === 'rewrite' && !selected) return;
      setRewriteTask(selected ?? null);
      setKind(next);
    } catch (error) {
      notifyFailure(error);
    }
  });

  const generate = useStableCallback(async () => {
    if (pending.current || materialsImporting || !composer.current) return;
    const sessionKey = model.generation.inputScopeKey;
    pending.current = true;
    setBusy(true);
    try {
      await composer.current.whenSettled();
      if (!isSessionCurrent(sessionKey)) return;
      const task = kind === 'rewrite' ? rewriteTask : composer.current?.captureWritingTask(kind);
      if (!task) return;
      if (kind === 'rewrite' && JSON.stringify(composer.current?.getDocument()) !== JSON.stringify(task.baseDocument)) {
        model.app.notify(labels.reselectText);
        return;
      }
      const prompt = blockDocumentMarkdown(task.baseDocument);
      const message = model.selection.writingInstruction;
      if (!prompt.trim() && !message.trim()) {
        model.app.notify(labels.inputRequired);
        return;
      }
      if (prompt.length > 30_000) {
        model.app.notify(labels.inputTooLong);
        return;
      }
      const scope = await model.draftInput.draftProjection.ensureScope();
      if (!isSessionCurrent(sessionKey) || !model.draftInput.draftProjection.isScopeCurrent(scope)) return;
      const result = await window.desktopApi.agentChat({
        scope,
        mode: 'chat',
        locale: model.app.locale,
        prompt,
        message,
        documentTask: task,
        attachmentAssetIds: [],
        referenceAssets: [],
        directTerms: [],
        recipes: [],
        webSearchMode: 'DISABLED',
      });
      if (!isSessionCurrent(sessionKey) || !model.draftInput.draftProjection.isScopeCurrent(scope)) return;
      mergeCandidates([result]);
      setCandidateId(result.id);
    } catch (error) {
      if (isSessionCurrent(sessionKey)) notifyFailure(error);
    } finally {
      pending.current = false;
      if (isSessionCurrent(sessionKey)) setBusy(false);
    }
  });

  const adopt = useStableCallback(async (placement: 'replace' | 'append') => {
    if (pending.current || materialsImporting || !candidate?.documentTask || !composer.current) return;
    const sessionKey = model.generation.inputScopeKey;
    pending.current = true;
    setBusy(true);
    try {
      await composer.current.whenSettled();
      if (!isSessionCurrent(sessionKey) || !model.draftInput.draftProjection.isScopeCurrent(candidate.scope)) return;
      // Save the author's current input before a reversible editor transaction.
      await model.draftInput.draftProjection.ensureScope();
      if (!isSessionCurrent(sessionKey) || !model.draftInput.draftProjection.isScopeCurrent(candidate.scope)) return;
      const applied = composer.current?.applyWritingCandidate(
        candidate.documentTask,
        candidate.result.assistantMessage,
        placement,
      );
      model.app.notify(applied ? labels.applied : labels.changed);
    } catch (error) {
      if (isSessionCurrent(sessionKey)) notifyFailure(error);
    } finally {
      pending.current = false;
      if (isSessionCurrent(sessionKey)) setBusy(false);
    }
  });
  const changed = Boolean(
    candidate?.documentTask &&
    JSON.stringify(candidate.documentTask.baseDocument) !== JSON.stringify(model.generation.promptDocument.document),
  );
  return {
    kind,
    chooseKind,
    selectedText: rewriteTask?.selection?.text ?? '',
    busy,
    loading,
    candidate,
    candidates,
    candidateId: candidate?.id ?? '',
    setCandidateId,
    cursor,
    historyFailed,
    loadHistory,
    generate,
    adopt,
    changed,
  };
}
