import { useEffect, useRef, useState } from 'react';
import type {
  VideoDocumentMediaBinding,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import type { VideoDocumentAutosaveStatus } from '@/renderer/features/video-documents/VideoDocumentAutosaveSettings';
import { useVideoDocumentAutosavePreferences } from '@/renderer/features/video-documents/videoDocumentAutosavePreferences';

type MarkdownContent = Extract<VideoDocumentRevisionContent, { format: 'MARKDOWN' }>;

interface Options {
  revision: VideoDocumentRevisionDto;
  content: MarkdownContent | null;
  selectedNoteId: string;
  generating: boolean;
  mutating: boolean;
  saveFailedLabel: string;
  autoSaveFailedLabel: string;
  onSave?(content: VideoDocumentRevisionContent): Promise<void>;
  onEditingChange?(editing: boolean): void;
  contentForCurrentNote(markdown: string, mediaBindings: VideoDocumentMediaBinding[]): VideoDocumentRevisionContent;
}

function activeMediaBindings(markdown: string, mediaBindings: readonly VideoDocumentMediaBinding[]) {
  return mediaBindings.filter((binding) => markdown.includes(binding.path));
}

function articleDraftSignature(markdown: string, mediaBindings: readonly VideoDocumentMediaBinding[]) {
  return JSON.stringify({ markdown, mediaBindings: activeMediaBindings(markdown, mediaBindings) });
}

function useEditingNotification(editing: boolean, onEditingChange: ((editing: boolean) => void) | undefined) {
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
}

export function useVideoDocumentArticleAutosave({
  revision,
  content,
  selectedNoteId,
  generating,
  mutating,
  saveFailedLabel,
  autoSaveFailedLabel,
  onSave,
  onEditingChange,
  contentForCurrentNote,
}: Options) {
  const { preferences: autoSavePreferences, setPreferences: setAutoSavePreferences } =
    useVideoDocumentAutosavePreferences();
  const [editing, setEditing] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [draftMediaBindings, setDraftMediaBindings] = useState<VideoDocumentMediaBinding[]>([]);
  const [draftMedia, setDraftMedia] = useState<VideoDocumentRevisionMediaDto[]>([]);
  const [saveMode, setSaveMode] = useState<'manual' | 'auto' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const initialPersistedSignature = content ? articleDraftSignature(content.markdown, content.mediaBindings) : '';
  const [persistedSignature, setPersistedSignature] = useState(initialPersistedSignature);
  const editingRef = useRef(editing);
  const saveModeRef = useRef(saveMode);
  const persistedSignatureRef = useRef(persistedSignature);
  const pendingAutoSaveRef = useRef<{ branchId: string; noteId: string; signature: string } | null>(null);
  const persistDraftRef = useRef<(mode: 'manual' | 'auto', markdown?: string) => Promise<void>>(async () => undefined);
  editingRef.current = editing;
  saveModeRef.current = saveMode;
  persistedSignatureRef.current = persistedSignature;
  const saving = saveMode !== null;
  const draftSignature = articleDraftSignature(draftMarkdown, draftMediaBindings);
  const isDirty = editing && draftSignature !== persistedSignature;
  const hasContent = Boolean(content);
  const canSave = Boolean(onSave);

  useEffect(() => {
    const incomingMarkdown = content?.markdown ?? '';
    const incomingMediaBindings = content?.mediaBindings ?? [];
    const incomingSignature = articleDraftSignature(incomingMarkdown, incomingMediaBindings);
    const pendingAutoSave = pendingAutoSaveRef.current;
    if (
      editingRef.current &&
      pendingAutoSave?.branchId === revision.branchId &&
      pendingAutoSave.noteId === selectedNoteId &&
      pendingAutoSave.signature === incomingSignature
    ) {
      pendingAutoSaveRef.current = null;
      persistedSignatureRef.current = incomingSignature;
      setPersistedSignature(incomingSignature);
      setSaveError('');
      setAutoSaveFailed(false);
      return;
    }

    pendingAutoSaveRef.current = null;
    editingRef.current = false;
    setEditing(false);
    setDraftMarkdown(incomingMarkdown);
    setDraftMediaBindings(incomingMediaBindings);
    setDraftMedia(revision.media);
    persistedSignatureRef.current = incomingSignature;
    setPersistedSignature(incomingSignature);
    setSaveError('');
    setAutoSaveFailed(false);
  }, [content?.markdown, content?.mediaBindings, revision.branchId, revision.id, revision.media, selectedNoteId]);
  useEditingNotification(editing, onEditingChange);

  persistDraftRef.current = async (mode, markdownOverride) => {
    const markdown = markdownOverride ?? draftMarkdown;
    if (!onSave || saveModeRef.current || generating || mutating || !markdown.trim()) return;
    const mediaBindings = activeMediaBindings(markdown, draftMediaBindings);
    const signature = articleDraftSignature(markdown, mediaBindings);
    if (signature === persistedSignatureRef.current) {
      if (mode === 'manual') {
        editingRef.current = false;
        setEditing(false);
      }
      return;
    }

    saveModeRef.current = mode;
    setSaveMode(mode);
    setSaveError('');
    setAutoSaveFailed(false);
    if (mode === 'auto') {
      pendingAutoSaveRef.current = { branchId: revision.branchId, noteId: selectedNoteId, signature };
    }
    try {
      await onSave(contentForCurrentNote(markdown, mediaBindings));
      persistedSignatureRef.current = signature;
      setPersistedSignature(signature);
      if (mode === 'manual') {
        setDraftMarkdown(markdown);
        editingRef.current = false;
        setEditing(false);
      }
    } catch {
      if (mode === 'auto') {
        pendingAutoSaveRef.current = null;
        setAutoSaveFailed(true);
        setSaveError(autoSaveFailedLabel);
      } else {
        setSaveError(saveFailedLabel);
      }
    } finally {
      saveModeRef.current = null;
      setSaveMode(null);
    }
  };

  useEffect(() => {
    if (
      !autoSavePreferences.enabled ||
      !canSave ||
      !hasContent ||
      !editing ||
      !isDirty ||
      saving ||
      generating ||
      mutating ||
      !draftMarkdown.trim()
    ) {
      return undefined;
    }
    const timeout = globalThis.setTimeout(() => void persistDraftRef.current('auto'), autoSavePreferences.delayMs);
    return () => globalThis.clearTimeout(timeout);
  }, [
    autoSavePreferences.delayMs,
    autoSavePreferences.enabled,
    canSave,
    draftMarkdown,
    draftSignature,
    editing,
    generating,
    hasContent,
    isDirty,
    mutating,
    saving,
  ]);

  const autoSaveStatus: VideoDocumentAutosaveStatus = !autoSavePreferences.enabled
    ? 'off'
    : saveMode === 'auto'
      ? 'saving'
      : autoSaveFailed
        ? 'failed'
        : isDirty
          ? 'pending'
          : 'saved';

  function startEditing() {
    if (!content) return;
    const signature = articleDraftSignature(content.markdown, content.mediaBindings);
    setDraftMarkdown(content.markdown);
    setDraftMediaBindings(content.mediaBindings);
    setDraftMedia(revision.media);
    persistedSignatureRef.current = signature;
    setPersistedSignature(signature);
    pendingAutoSaveRef.current = null;
    setSaveError('');
    setAutoSaveFailed(false);
    editingRef.current = true;
    setEditing(true);
  }

  function cancelEditing() {
    if (!content) return;
    const signature = articleDraftSignature(content.markdown, content.mediaBindings);
    setDraftMarkdown(content.markdown);
    setDraftMediaBindings(content.mediaBindings);
    setDraftMedia(revision.media);
    persistedSignatureRef.current = signature;
    setPersistedSignature(signature);
    pendingAutoSaveRef.current = null;
    setSaveError('');
    setAutoSaveFailed(false);
    editingRef.current = false;
    setEditing(false);
  }

  function changeDraftMarkdown(markdown: string) {
    setDraftMarkdown(markdown);
    setSaveError('');
    setAutoSaveFailed(false);
  }

  return {
    editing,
    draftMarkdown,
    draftMediaBindings,
    draftMedia,
    saving,
    saveError,
    autoSavePreferences,
    autoSaveStatus,
    setAutoSavePreferences,
    setDraftMediaBindings,
    setDraftMedia,
    setSaveError,
    startEditing,
    cancelEditing,
    changeDraftMarkdown,
    save(markdown?: string) {
      return persistDraftRef.current('manual', markdown);
    },
  };
}
