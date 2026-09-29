import { useRef, useState } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { contentAssetPath } from '@/shared/content-document';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
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
  const [surface, setSurface] = useState<'write' | 'materials'>('write');
  const [title, setTitle] = useState(copy.exampleTitle);
  const [markdown, setMarkdown] = useState(
    `## ${copy.exampleHeading}\n\n${copy.exampleIntro}\n\n${copy.exampleParagraph}`,
  );
  const [epoch, setEpoch] = useState(0);
  const [inputIds, setInputIds] = useState(['external', 'notes']);
  const [selectedMaterialId, setSelectedMaterialId] = useState('notes');
  const [selectedText, setSelectedText] = useState('');
  const [notice, setNotice] = useState('');
  const [requirements, setRequirements] = useState(copy.exampleRequirement);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [candidateImage, setCandidateImage] = useState(0);
  const [adoptedAssetIds, setAdoptedAssetIds] = useState<string[]>([]);
  const [records, setRecords] = useState<OperationKind[]>([]);
  const [operation, setOperation] = useState<{
    kind: OperationKind;
    base: string;
    input: string;
    selection: boolean;
  } | null>(null);
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
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

  function addInput(id: string) {
    setInputIds((current) => (current.includes(id) ? current : [...current, id]));
    setSelectedMaterialId(id);
    setNotice(copy.used);
  }

  async function captureDraft() {
    const editor = editorHandle.current;
    if (editor && !(await editor.whenSettled())) return null;
    return editor?.getPersistenceSnapshot().markdown ?? markdown;
  }

  async function begin(kind: OperationKind) {
    const base = await captureDraft();
    if (base === null) return;
    const first = selectedText ? base.indexOf(selectedText) : -1;
    const selection = first >= 0 && base.indexOf(selectedText, first + selectedText.length) < 0;
    setMarkdown(base);
    setOperation({ kind, base, input: selection ? selectedText : base, selection });
    setRequirements(kind === 'rewrite' ? copy.exampleRequirement : copy.exampleImageRequirement);
    setCandidate(null);
    setImageReady(false);
    setNotice('');
    setSurface('write');
  }

  function previewCandidate() {
    if (!operation) return;
    if (operation.kind === 'rewrite') {
      setCandidate(operation.input.replace(copy.exampleParagraph, copy.exampleRewrite));
    } else setImageReady(true);
    setRecords((current) => [...current, operation.kind]);
  }

  async function adopt() {
    if (!operation) return;
    const current = await captureDraft();
    if (current === null) return;
    if (current !== operation.base) return setNotice(copy.stale);
    let next = current;
    if (operation.kind === 'rewrite') {
      if (candidate === null) return;
      next = operation.selection ? current.replace(operation.input, candidate) : candidate;
    } else {
      if (!imageReady) return;
      const asset = cycleAssets[candidateImage];
      const image = `\n\n![${copy.image}](${contentAssetPath(asset.id)})`;
      next = operation.selection ? current.replace(operation.input, operation.input + image) : current + image;
      setAdoptedAssetIds((ids) => [...new Set([...ids, asset.id])]);
    }
    setMarkdown(next);
    setEpoch((currentEpoch) => currentEpoch + 1);
    setSelectedText('');
    setOperation(null);
    setNotice(operation.kind === 'image' ? copy.imageInserted : copy.adopted);
  }

  return {
    copy,
    surface,
    setSurface,
    title,
    setTitle,
    markdown,
    setMarkdown,
    epoch,
    editorHandle,
    inputIds,
    setInputIds,
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
    adoptedAssetIds,
    records,
    materials,
    addInput,
    begin,
    previewCandidate,
    adopt,
  };
}

export type CycleModel = ReturnType<typeof useCycleModel>;
