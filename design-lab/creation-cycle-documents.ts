import { useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';

export type CycleCopy = ReturnType<typeof useI18n>['messages']['designLab']['creationCycle'];
export type InputScope = 'shared' | 'current';
export interface DraftContent {
  title: string;
  markdown: string;
  assetId?: string;
}
export interface CycleDraft extends DraftContent {
  id: string;
  channel?: 'wechat' | 'xiaohongshu';
  sourceRevision?: number;
  inputIds: string[];
  history: DraftContent[];
}
export interface CycleOutput {
  id: string;
  kind: 'ARTICLE' | 'IMAGE';
  drafts: CycleDraft[];
  derivedFrom?: { outputId: string; draftId: string; snapshot: DraftContent };
}
export interface DraftTarget {
  outputId: string;
  draftId: string;
}

function initialOutputs(copy: CycleCopy): CycleOutput[] {
  const original = {
    title: copy.exampleTitle,
    markdown: `## ${copy.exampleHeading}\n\n${copy.exampleIntro}\n\n${copy.exampleParagraph}`,
  };
  const makeDraft = (content: DraftContent, inputIds: string[]): CycleDraft => ({
    ...content,
    id: 'original',
    inputIds,
    history: [{ ...content }],
  });
  return [
    {
      id: 'article',
      kind: 'ARTICLE',
      drafts: [
        makeDraft(original, ['notes']),
        {
          ...makeDraft({ title: copy.wechatTitle, markdown: original.markdown }, ['notes']),
          id: 'wechat',
          channel: 'wechat',
          sourceRevision: 1,
        },
        {
          ...makeDraft({ title: copy.xiaohongshuTitle, markdown: copy.xiaohongshuBody }, []),
          id: 'xiaohongshu',
          channel: 'xiaohongshu',
          sourceRevision: 1,
        },
      ],
    },
    {
      id: 'checklist',
      kind: 'ARTICLE',
      drafts: [makeDraft({ title: copy.checklistTitle, markdown: copy.checklistBody }, ['notes'])],
    },
    {
      id: 'cover',
      kind: 'IMAGE',
      drafts: [makeDraft({ title: copy.coverTitle, markdown: '', assetId: 'cycle-image-0' }, ['cycle-image-1'])],
    },
  ];
}

export function sameDraft(left: DraftContent, right: DraftContent) {
  return left.title === right.title && left.markdown === right.markdown && left.assetId === right.assetId;
}

export function useCycleDocuments(copy: CycleCopy) {
  const [outputs, setOutputs] = useState(() => initialOutputs(copy));
  const [target, setTarget] = useState<DraftTarget>({ outputId: 'article', draftId: 'original' });
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const output = outputs.find((item) => item.id === target.outputId)!;
  const draft = output.drafts.find((item) => item.id === target.draftId)!;
  const contextKey = `${target.outputId}/${target.draftId}`;
  const contextLabel = draft.channel ? copy[draft.channel] : copy.original;
  const dirty = !sameDraft(draft, draft.history[draft.history.length - 1]);

  function patchDraft(patch: Partial<DraftContent>, destination = target) {
    setOutputs((items) =>
      items.map((item) =>
        item.id !== destination.outputId
          ? item
          : {
              ...item,
              drafts: item.drafts.map((entry) => (entry.id === destination.draftId ? { ...entry, ...patch } : entry)),
            },
      ),
    );
  }

  function setCurrentInputs(update: (ids: string[]) => string[]) {
    setOutputs((items) =>
      items.map((item) =>
        item.id !== target.outputId
          ? item
          : {
              ...item,
              drafts: item.drafts.map((entry) =>
                entry.id === target.draftId ? { ...entry, inputIds: update(entry.inputIds) } : entry,
              ),
            },
      ),
    );
  }

  // Keep the editor mounted during processing. Settle it before changing the editing target.
  async function captureDraft(): Promise<DraftContent | null> {
    const editor = output.kind === 'ARTICLE' ? editorHandle.current : null;
    if (editor && !(await editor.whenSettled())) return null;
    return {
      title: draft.title,
      markdown: editor?.getPersistenceSnapshot().markdown ?? draft.markdown,
      assetId: draft.assetId,
    };
  }

  async function withSettledDraft(action: (content: DraftContent) => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const content = await captureDraft();
      if (content) {
        patchDraft(content);
        action(content);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function switchTarget(next: DraftTarget) {
    if (!outputs.some((item) => item.id === next.outputId && item.drafts.some((entry) => entry.id === next.draftId)))
      return;
    if (next.outputId === target.outputId && next.draftId === target.draftId) return;
    editorHandle.current = null;
    setTarget(next);
  }

  function saveRevision(content: DraftContent) {
    setOutputs((items) =>
      items.map((item) =>
        item.id !== target.outputId
          ? item
          : {
              ...item,
              drafts: item.drafts.map((entry) =>
                entry.id !== target.draftId
                  ? entry
                  : {
                      ...entry,
                      ...content,
                      history: sameDraft(content, entry.history[entry.history.length - 1])
                        ? entry.history
                        : [...entry.history, { ...content }],
                    },
              ),
            },
      ),
    );
  }

  function createIndependent(
    content: DraftContent,
    kind: CycleOutput['kind'],
    source: DraftContent,
    inputIds: string[],
  ) {
    const id = `output-${crypto.randomUUID()}`;
    setOutputs((items) => [
      ...items,
      {
        id,
        kind,
        derivedFrom: { ...target, snapshot: { ...source } },
        drafts: [{ ...content, id: 'original', inputIds: [...inputIds], history: [{ ...content }] }],
      },
    ]);
    editorHandle.current = null;
    setTarget({ outputId: id, draftId: 'original' });
  }

  return {
    outputs,
    target,
    output,
    draft,
    contextKey,
    contextLabel,
    dirty,
    busy,
    epoch,
    editorHandle,
    patchDraft,
    setCurrentInputs,
    withSettledDraft,
    switchTarget,
    saveRevision,
    createIndependent,
    remountEditor: () => setEpoch((value) => value + 1),
  };
}
