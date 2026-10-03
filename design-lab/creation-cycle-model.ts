import { useState } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { contentAssetPath } from '@/shared/content-document';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  sameDraft,
  useCycleDocuments,
  type DraftContent,
  type DraftTarget,
  type InputScope,
} from './creation-cycle-documents';
import { landscape, portrait } from './fixtures';

export type OperationKind = 'rewrite' | 'image';
export interface CycleMaterial {
  id: string;
  kind: 'ARTICLE' | 'IMAGE';
  title: string;
  author: string;
  markdown: string | null;
  asset?: AssetDto;
}
interface CycleOperation {
  kind: OperationKind;
  target: DraftTarget;
  targetLabel: string;
  base: DraftContent;
  input: string;
  selection: boolean;
  availableInputIds: string[];
}
interface CycleRecord {
  kind: OperationKind;
  targetLabel: string;
  input: string;
  requirements: string;
  references: CycleMaterial[];
}

export const cycleAssets: AssetDto[] = [landscape, portrait].map((mediaUrl, index) => ({
  id: `cycle-image-${index}`,
  kind: 'REFERENCE',
  createdAt: '2026-09-28T00:00:00Z',
  mediaUrl,
  mimeType: 'image/svg+xml',
  byteSize: 2000,
  width: index ? 400 : 600,
  height: index ? 600 : 400,
}));

export function useCycleModel() {
  const copy = useI18n().messages.designLab.creationCycle;
  const documents = useCycleDocuments(copy);
  const [surface, setSurface] = useState<'write' | 'materials'>('write');
  const [sharedInputIds, setSharedInputIds] = useState(['external']);
  const [selectedMaterialId, setSelectedMaterialId] = useState('notes');
  const [selectedText, setSelectedText] = useState('');
  const [notice, setNotice] = useState('');
  const [requirements, setRequirements] = useState(copy.exampleRequirement);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [candidateImage, setCandidateImage] = useState(0);
  const [references, setReferences] = useState<string[]>([]);
  const [records, setRecords] = useState<CycleRecord[]>([]);
  const [operation, setOperation] = useState<CycleOperation | null>(null);
  const inputIds = [...new Set([...sharedInputIds, ...documents.draft.inputIds])];
  const materials: CycleMaterial[] = [
    { id: 'external', kind: 'ARTICLE', title: copy.externalTitle, author: copy.unknownAuthor, markdown: null },
    { id: 'notes', kind: 'ARTICLE', title: copy.exampleNoteTitle, author: copy.mine, markdown: copy.exampleNote },
    { id: 'feedback', kind: 'ARTICLE', title: copy.exampleComment, author: copy.mine, markdown: copy.exampleComment },
    ...cycleAssets.map((asset, index) => ({
      id: asset.id,
      kind: 'IMAGE' as const,
      title: `${copy.referenceTitle} ${index + 1}`,
      author: copy.unknownAuthor,
      markdown: null,
      asset,
    })),
  ];
  const adoptedAssetIds = cycleAssets
    .filter(
      (asset) => documents.draft.assetId === asset.id || documents.draft.markdown.includes(contentAssetPath(asset.id)),
    )
    .map((asset) => asset.id);

  function addInput(id: string, scope: InputScope = 'current') {
    const update = (ids: string[]) => (ids.includes(id) ? ids : [...ids, id]);
    if (scope === 'shared') setSharedInputIds(update);
    else documents.setCurrentInputs(update);
    setSelectedMaterialId(id);
    setNotice(copy.used);
  }

  function removeInput(id: string, scope: InputScope) {
    const update = (ids: string[]) => ids.filter((item) => item !== id);
    if (scope === 'shared') setSharedInputIds(update);
    else documents.setCurrentInputs(update);
  }

  function switchDraft(outputId: string, draftId = 'original') {
    if (operation) return;
    return documents.withSettledDraft(() => {
      documents.switchTarget({ outputId, draftId });
      setSelectedText('');
      setSurface('write');
      setNotice('');
    });
  }

  function begin(kind: OperationKind) {
    if (operation) return;
    return documents.withSettledDraft((base) => {
      const first = selectedText ? base.markdown.indexOf(selectedText) : -1;
      const selection = first >= 0 && base.markdown.indexOf(selectedText, first + selectedText.length) < 0;
      if (selectedText && !selection) return setNotice(copy.selectionUnavailable);
      setOperation({
        kind,
        base,
        target: documents.target,
        targetLabel: `${base.title} / ${documents.contextLabel}`,
        input: selection ? selectedText : base.markdown,
        selection,
        availableInputIds: [...inputIds],
      });
      setRequirements(kind === 'rewrite' ? copy.exampleRequirement : copy.exampleImageRequirement);
      setReferences([]);
      setCandidate(null);
      setImageReady(false);
      setCandidateImage(0);
      setNotice('');
      setSurface('write');
    });
  }

  function previewCandidate() {
    if (!operation) return;
    if (operation.kind === 'rewrite') {
      setCandidate(
        operation.input.includes(copy.exampleParagraph)
          ? operation.input.replace(copy.exampleParagraph, copy.exampleRewrite)
          : operation.input,
      );
    } else setImageReady(true);
    setRecords((current) => [
      ...current,
      {
        kind: operation.kind,
        targetLabel: operation.targetLabel,
        input: operation.input,
        requirements,
        references: materials.filter((item) => references.includes(item.id)).map((item) => ({ ...item })),
      },
    ]);
  }

  function adopt(independent = false) {
    if (!operation) return;
    return documents.withSettledDraft((current) => {
      if (
        documents.target.outputId !== operation.target.outputId ||
        documents.target.draftId !== operation.target.draftId ||
        (!independent && !sameDraft(current, operation.base))
      )
        return setNotice(copy.stale);
      const next = { ...operation.base };
      const image = operation.kind === 'image';
      if (image) {
        if (!imageReady) return;
        const asset = cycleAssets[candidateImage];
        if (independent || documents.output.kind === 'IMAGE') {
          next.assetId = asset.id;
          next.markdown = '';
        } else {
          const insert = `\n\n![${copy.image}](${contentAssetPath(asset.id)})\n\n`;
          next.markdown = operation.selection
            ? next.markdown.replace(operation.input, () => operation.input + insert)
            : next.markdown + insert;
        }
      } else {
        if (candidate === null) return;
        next.markdown = operation.selection ? next.markdown.replace(operation.input, () => candidate) : candidate;
      }
      if (independent) {
        next.title = `${operation.base.title} · ${image ? copy.image : copy.independentDraft}`;
        documents.createIndependent(next, image ? 'IMAGE' : 'ARTICLE', operation.base, documents.draft.inputIds);
      } else {
        documents.saveRevision(next);
        documents.remountEditor();
      }
      setSelectedText('');
      setOperation(null);
      setNotice(independent ? copy.independentSaved : copy.adopted);
    });
  }

  function saveRevision() {
    return documents.withSettledDraft((content) => {
      documents.saveRevision(content);
      setNotice(copy.revisionSaved);
    });
  }

  return {
    ...documents,
    copy,
    surface,
    setSurface,
    title: documents.draft.title,
    setTitle: (title: string) => documents.patchDraft({ title }),
    markdown: documents.draft.markdown,
    setMarkdown: (markdown: string) => documents.patchDraft({ markdown }),
    inputIds,
    sharedInputIds,
    currentInputIds: documents.draft.inputIds,
    selectedMaterialId,
    setSelectedMaterialId,
    selectedText,
    setSelectedText,
    notice,
    setNotice,
    operation,
    setOperation,
    requirements,
    setRequirements,
    candidate,
    setCandidate,
    imageReady,
    candidateImage,
    setCandidateImage,
    references,
    setReferences,
    adoptedAssetIds,
    records,
    materials,
    addInput,
    removeInput,
    switchDraft,
    begin,
    previewCandidate,
    adopt,
    saveRevision,
  };
}

export type CycleModel = ReturnType<typeof useCycleModel>;
