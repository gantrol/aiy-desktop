import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  VideoDocumentMediaBinding,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import type { VideoDocumentAutosaveStatus } from '@/renderer/features/video-documents/VideoDocumentAutosaveSettings';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import {
  type VideoDocumentArticleHeading,
  videoDocumentArticleHeadings,
} from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';
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

interface ArticleDraftSnapshot {
  markdown: string;
  mediaBindings: VideoDocumentMediaBinding[];
  signature: string;
  hasContent: boolean;
  headings: VideoDocumentArticleHeading[];
}

interface PendingSave {
  requestId: number;
  contextIdentity: string;
  signature: string;
}

interface ObservedIncoming {
  contextIdentity: string;
  revisionId: string;
  signature: string;
}

interface IncomingRevisionOptions {
  contextIdentity: string;
  revisionId: string;
  snapshot: ArticleDraftSnapshot;
  media: readonly VideoDocumentRevisionMediaDto[];
  saveFailedLabel: string;
  observed: { current: ObservedIncoming };
  pendingAcknowledgement: { current: PendingSave | null };
  latestDraft: { current: ArticleDraftSnapshot };
  persistedSignature: { current: string };
  editing: { current: boolean };
  draftMedia: { current: VideoDocumentRevisionMediaDto[] };
  setPersistedSignature(signature: string): void;
  setDraftMedia(media: VideoDocumentRevisionMediaDto[]): void;
  setSaveError(message: string): void;
  setAutoSaveFailed(failed: boolean): void;
  loadPersistedDraft(
    contextIdentity: string,
    snapshot: ArticleDraftSnapshot,
    media: readonly VideoDocumentRevisionMediaDto[],
  ): void;
}

const EMPTY_MEDIA_BINDINGS: readonly VideoDocumentMediaBinding[] = [];

function activeMediaBindings(markdown: string, mediaBindings: readonly VideoDocumentMediaBinding[]) {
  return mediaBindings.filter((binding) => markdown.includes(binding.path));
}

function articleDraftSignature(markdown: string, mediaBindings: readonly VideoDocumentMediaBinding[]) {
  return JSON.stringify({ markdown, mediaBindings: activeMediaBindings(markdown, mediaBindings) });
}

function articleDraftSnapshot(
  markdown: string,
  mediaBindings: readonly VideoDocumentMediaBinding[],
): ArticleDraftSnapshot {
  const activeBindings = activeMediaBindings(markdown, mediaBindings);
  return {
    markdown,
    mediaBindings: activeBindings,
    signature: articleDraftSignature(markdown, activeBindings),
    hasContent: Boolean(markdown.trim()),
    headings: videoDocumentArticleHeadings(markdown),
  };
}

function upsertMediaBinding(
  current: readonly VideoDocumentMediaBinding[],
  binding: VideoDocumentMediaBinding,
): VideoDocumentMediaBinding[] {
  return [...current.filter((candidate) => candidate.path !== binding.path), binding];
}

function mergeMedia(
  current: readonly VideoDocumentRevisionMediaDto[],
  incoming: readonly VideoDocumentRevisionMediaDto[],
): VideoDocumentRevisionMediaDto[] {
  const merged = new Map(current.map((media) => [media.assetId, media]));
  for (const media of incoming) merged.set(media.assetId, media);
  return [...merged.values()];
}

function useEditingNotification(editing: boolean, onEditingChange: ((editing: boolean) => void) | undefined) {
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
}

function applyIncomingArticleRevision({
  contextIdentity,
  revisionId,
  snapshot,
  media,
  saveFailedLabel,
  observed,
  pendingAcknowledgement,
  latestDraft,
  persistedSignature,
  editing,
  draftMedia,
  setPersistedSignature,
  setDraftMedia,
  setSaveError,
  setAutoSaveFailed,
  loadPersistedDraft,
}: IncomingRevisionOptions) {
  const previous = observed.current;
  if (
    previous.contextIdentity === contextIdentity &&
    previous.revisionId === revisionId &&
    previous.signature === snapshot.signature
  ) {
    return;
  }
  observed.current = { contextIdentity, revisionId, signature: snapshot.signature };
  if (previous.contextIdentity !== contextIdentity) {
    loadPersistedDraft(contextIdentity, snapshot, media);
    return;
  }

  const pending = pendingAcknowledgement.current;
  const acknowledgementMatches =
    pending?.contextIdentity === contextIdentity && pending.signature === snapshot.signature;
  if (
    acknowledgementMatches ||
    snapshot.signature === latestDraft.current.signature ||
    snapshot.signature === persistedSignature.current
  ) {
    if (acknowledgementMatches || snapshot.signature === latestDraft.current.signature) {
      pendingAcknowledgement.current = null;
      persistedSignature.current = snapshot.signature;
      setPersistedSignature(snapshot.signature);
      setSaveError('');
      setAutoSaveFailed(false);
    }
    const nextMedia = mergeMedia(draftMedia.current, media);
    draftMedia.current = nextMedia;
    setDraftMedia(nextMedia);
    return;
  }

  pendingAcknowledgement.current = null;
  if (!editing.current) {
    loadPersistedDraft(contextIdentity, snapshot, media);
    return;
  }
  setSaveError(saveFailedLabel);
}

function useArticleAutosaveTimer({
  enabled,
  delayMs,
  ready,
  draftSignature,
  persistDraft,
}: {
  enabled: boolean;
  delayMs: number;
  ready: boolean;
  draftSignature: string;
  persistDraft: { current: (mode: 'manual' | 'auto', markdown?: string) => Promise<void> };
}) {
  useEffect(() => {
    if (!enabled || !ready) return undefined;
    const timeout = globalThis.setTimeout(() => void persistDraft.current('auto'), delayMs);
    return () => globalThis.clearTimeout(timeout);
  }, [delayMs, draftSignature, enabled, persistDraft, ready]);
}

function articleAutoSaveStatus(
  enabled: boolean,
  saveMode: 'manual' | 'auto' | null,
  failed: boolean,
  dirty: boolean,
): VideoDocumentAutosaveStatus {
  if (!enabled) return 'off';
  if (saveMode === 'auto') return 'saving';
  if (failed) return 'failed';
  return dirty ? 'pending' : 'saved';
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
  const incomingMarkdown = content?.markdown ?? '';
  const incomingMediaBindings = content?.mediaBindings ?? EMPTY_MEDIA_BINDINGS;
  const incomingSnapshot = useMemo(
    () => articleDraftSnapshot(incomingMarkdown, incomingMediaBindings),
    [incomingMarkdown, incomingMediaBindings],
  );
  const contextIdentity = `${revision.branchId}:${selectedNoteId}`;
  const initialSnapshotRef = useRef(incomingSnapshot);
  const [loadedContextIdentity, setLoadedContextIdentity] = useState(contextIdentity);
  const [initialMarkdown, setInitialMarkdown] = useState(initialSnapshotRef.current.markdown);
  const [editorSessionEpoch, setEditorSessionEpoch] = useState(0);
  const [editingState, setEditingState] = useState(false);
  const [draftState, setDraftState] = useState(() => ({
    signature: initialSnapshotRef.current.signature,
    hasContent: initialSnapshotRef.current.hasContent,
    headings: initialSnapshotRef.current.headings,
  }));
  const [draftMediaBindings, setDraftMediaBindings] = useState<VideoDocumentMediaBinding[]>(
    initialSnapshotRef.current.mediaBindings,
  );
  const [draftMedia, setDraftMedia] = useState<VideoDocumentRevisionMediaDto[]>(revision.media);
  const [saveMode, setSaveMode] = useState<'manual' | 'auto' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [persistedSignature, setPersistedSignature] = useState(initialSnapshotRef.current.signature);
  const editorHandleRef = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const latestDraftRef = useRef(initialSnapshotRef.current);
  const draftMediaBindingsRef = useRef<VideoDocumentMediaBinding[]>(initialSnapshotRef.current.mediaBindings);
  const draftMediaRef = useRef<VideoDocumentRevisionMediaDto[]>(revision.media);
  const persistedSignatureRef = useRef(initialSnapshotRef.current.signature);
  const editingRef = useRef(false);
  const saveModeRef = useRef<'manual' | 'auto' | null>(null);
  const requestSequenceRef = useRef(0);
  const activeSaveRef = useRef<PendingSave | null>(null);
  const pendingAcknowledgementRef = useRef<PendingSave | null>(null);
  const contextIdentityRef = useRef(contextIdentity);
  const observedIncomingRef = useRef({
    contextIdentity,
    revisionId: revision.id,
    signature: incomingSnapshot.signature,
  });
  const persistDraftRef = useRef<(mode: 'manual' | 'auto', markdown?: string) => Promise<void>>(async () => undefined);
  contextIdentityRef.current = contextIdentity;
  const editing = editingState && loadedContextIdentity === contextIdentity;
  const saving = saveMode !== null;
  const isDirty = editing && draftState.signature !== persistedSignature;
  const canSave = Boolean(onSave);

  const publishSnapshot = useCallback(
    (markdown: string, mediaBindings: readonly VideoDocumentMediaBinding[] = draftMediaBindingsRef.current) => {
      const snapshot = articleDraftSnapshot(markdown, mediaBindings);
      latestDraftRef.current = snapshot;
      setDraftState({
        signature: snapshot.signature,
        hasContent: snapshot.hasContent,
        headings: snapshot.headings,
      });
      return snapshot;
    },
    [],
  );

  const loadPersistedDraft = useCallback(
    (nextContextIdentity: string, snapshot: ArticleDraftSnapshot, media: readonly VideoDocumentRevisionMediaDto[]) => {
      latestDraftRef.current = snapshot;
      draftMediaBindingsRef.current = snapshot.mediaBindings;
      draftMediaRef.current = [...media];
      persistedSignatureRef.current = snapshot.signature;
      editingRef.current = false;
      saveModeRef.current = null;
      activeSaveRef.current = null;
      pendingAcknowledgementRef.current = null;
      editorHandleRef.current = null;
      setLoadedContextIdentity(nextContextIdentity);
      setInitialMarkdown(snapshot.markdown);
      setDraftState({
        signature: snapshot.signature,
        hasContent: snapshot.hasContent,
        headings: snapshot.headings,
      });
      setDraftMediaBindings(snapshot.mediaBindings);
      setDraftMedia([...media]);
      setPersistedSignature(snapshot.signature);
      setEditingState(false);
      setSaveMode(null);
      setSaveError('');
      setAutoSaveFailed(false);
      setEditorSessionEpoch((current) => current + 1);
    },
    [],
  );

  useEffect(() => {
    applyIncomingArticleRevision({
      contextIdentity,
      revisionId: revision.id,
      snapshot: incomingSnapshot,
      media: revision.media,
      saveFailedLabel,
      observed: observedIncomingRef,
      pendingAcknowledgement: pendingAcknowledgementRef,
      latestDraft: latestDraftRef,
      persistedSignature: persistedSignatureRef,
      editing: editingRef,
      draftMedia: draftMediaRef,
      setPersistedSignature,
      setDraftMedia,
      setSaveError,
      setAutoSaveFailed,
      loadPersistedDraft,
    });
  }, [contextIdentity, incomingSnapshot, loadPersistedDraft, revision.id, revision.media, saveFailedLabel]);
  useEditingNotification(editing, onEditingChange);

  persistDraftRef.current = async (mode, markdownOverride) => {
    const markdown =
      markdownOverride ?? editorHandleRef.current?.getPersistenceSnapshot().markdown ?? latestDraftRef.current.markdown;
    const snapshot = publishSnapshot(markdown);
    if (!onSave || saveModeRef.current || generating || mutating || !snapshot.hasContent) return;
    if (snapshot.signature === persistedSignatureRef.current) {
      setSaveError('');
      setAutoSaveFailed(false);
      if (mode === 'manual' && latestDraftRef.current.signature === snapshot.signature) {
        editingRef.current = false;
        setEditingState(false);
      }
      return;
    }

    const request: PendingSave = {
      requestId: (requestSequenceRef.current += 1),
      contextIdentity,
      signature: snapshot.signature,
    };
    activeSaveRef.current = request;
    pendingAcknowledgementRef.current = request;
    saveModeRef.current = mode;
    setSaveMode(mode);
    setSaveError('');
    setAutoSaveFailed(false);
    try {
      await onSave(contentForCurrentNote(snapshot.markdown, snapshot.mediaBindings));
      if (
        contextIdentityRef.current !== request.contextIdentity ||
        activeSaveRef.current?.requestId !== request.requestId
      ) {
        return;
      }
      persistedSignatureRef.current = snapshot.signature;
      setPersistedSignature(snapshot.signature);
      if (mode === 'manual' && latestDraftRef.current.signature === snapshot.signature) {
        editingRef.current = false;
        setEditingState(false);
      }
    } catch {
      if (
        contextIdentityRef.current !== request.contextIdentity ||
        activeSaveRef.current?.requestId !== request.requestId
      ) {
        return;
      }
      pendingAcknowledgementRef.current = null;
      if (mode === 'auto') {
        setAutoSaveFailed(true);
        setSaveError(autoSaveFailedLabel);
      } else {
        setSaveError(saveFailedLabel);
      }
    } finally {
      if (activeSaveRef.current?.requestId === request.requestId) {
        activeSaveRef.current = null;
        saveModeRef.current = null;
        setSaveMode(null);
      }
    }
  };

  useArticleAutosaveTimer({
    enabled: autoSavePreferences.enabled,
    delayMs: autoSavePreferences.delayMs,
    ready:
      canSave && Boolean(content) && editing && isDirty && !saving && !generating && !mutating && draftState.hasContent,
    draftSignature: draftState.signature,
    persistDraft: persistDraftRef,
  });

  const autoSaveStatus = articleAutoSaveStatus(autoSavePreferences.enabled, saveMode, autoSaveFailed, isDirty);

  function startEditing() {
    if (!content) return;
    loadPersistedDraft(contextIdentity, articleDraftSnapshot(content.markdown, content.mediaBindings), revision.media);
    editingRef.current = true;
    setEditingState(true);
  }

  function cancelEditing() {
    if (!content) return;
    loadPersistedDraft(contextIdentity, articleDraftSnapshot(content.markdown, content.mediaBindings), revision.media);
  }

  function changeDraftMarkdown(markdown: string) {
    publishSnapshot(markdown);
    setAutoSaveFailed(false);
    setSaveError('');
  }

  function registerEditor(handle: VideoDocumentWysiwygEditorHandle | null) {
    editorHandleRef.current = handle;
  }

  function addDraftMedia(binding: VideoDocumentMediaBinding, media: VideoDocumentRevisionMediaDto) {
    const nextBindings = upsertMediaBinding(draftMediaBindingsRef.current, binding);
    const nextMedia = mergeMedia(draftMediaRef.current, [media]);
    draftMediaBindingsRef.current = nextBindings;
    draftMediaRef.current = nextMedia;
    setDraftMediaBindings(nextBindings);
    setDraftMedia(nextMedia);
    publishSnapshot(
      editorHandleRef.current?.getPersistenceSnapshot().markdown ?? latestDraftRef.current.markdown,
      nextBindings,
    );
  }

  return {
    editing,
    initialMarkdown,
    editorSessionIdentity: `${contextIdentity}:${editorSessionEpoch}`,
    draftHasContent: draftState.hasContent,
    draftHeadings: draftState.headings,
    draftMediaBindings,
    draftMedia,
    saving,
    saveError,
    autoSavePreferences,
    autoSaveStatus,
    setAutoSavePreferences,
    setSaveError,
    startEditing,
    cancelEditing,
    changeDraftMarkdown,
    registerEditor,
    addDraftMedia,
    save(markdown?: string) {
      return persistDraftRef.current('manual', markdown);
    },
  };
}
