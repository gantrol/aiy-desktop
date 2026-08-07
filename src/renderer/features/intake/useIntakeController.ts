import { useEffect, useReducer, useRef } from 'react';
import type {
  ImportedImageMetadataInput,
  ImportedImageRelationshipInput,
  IntakeCommitIntent,
  IntakeCommitResult,
  IntakeCommitSource,
} from '@/shared/contracts';
import { transferSourceUrl } from '@/renderer/components/creator/imageImport';
import {
  createInitialIntakeState,
  intakeReducer,
  maxIntakeItems,
  type LocalIntakeItem,
} from '@/renderer/features/intake/intake-state';
import type { IntakeContext } from '@/renderer/features/intake/intake-context-policy';
import { intakeMediaMimeType, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { intakePreview, releaseIntakePreview } from '@/renderer/features/intake/intakePreview';

const maxImageBytes = 25 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const maxBatchBytes = 100 * 1024 * 1024;

export interface IntakeCommitOptions {
  favorite?: boolean;
  albumId?: string | null;
  imageDetails?: Readonly<
    Record<
      string,
      {
        metadata: ImportedImageMetadataInput;
        relationship: ImportedImageRelationshipInput | null;
      }
    >
  >;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function clipboardMediaFiles(clipboard: DataTransfer) {
  const itemFiles = [...clipboard.items]
    .filter((item) => item.kind === 'file')
    .flatMap((item) => item.getAsFile() ?? []);
  return itemFiles.length ? itemFiles : [...clipboard.files];
}

export function useIntakeController(
  context: IntakeContext,
  onCommitted: (result: IntakeCommitResult) => void,
  enabled = true,
) {
  const [state, dispatch] = useReducer(intakeReducer, context, createInitialIntakeState);
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;

  useEffect(
    () => () => {
      for (const item of itemsRef.current) if (item.kind === 'IMAGE') releaseIntakePreview(item.previewUrl);
    },
    [],
  );

  async function add(source: IntakeCommitSource, files: File[], text: string, sourceUrl = '') {
    if (!enabled || state.pendingIntent) return;
    const existing = itemsRef.current;
    const room = maxIntakeItems - existing.length;
    let usedBytes = existing.reduce((total, item) => total + (item.kind === 'IMAGE' ? item.file.size : 0), 0);

    const rejected: string[] = [];
    const accepted: Array<{ file: File; mimeType: NonNullable<ReturnType<typeof intakeMediaMimeType>> }> = [];
    for (const file of files) {
      const mimeType = intakeMediaMimeType(file);
      if (!mimeType || file.size <= 0) {
        rejected.push(file.name || 'media');
        continue;
      }
      const maxItemBytes = isIntakeVideoMimeType(mimeType) ? maxVideoBytes : maxImageBytes;
      if (file.size > maxItemBytes || usedBytes + file.size > maxBatchBytes) {
        rejected.push(file.name || 'media');
        continue;
      }
      if (accepted.length >= room) {
        rejected.push(file.name || 'media');
        continue;
      }
      usedBytes += file.size;
      accepted.push({ file, mimeType });
    }
    const trimmedText = text.trim();
    const wantsText = Boolean(trimmedText) && accepted.length < room;
    if (!accepted.length && !wantsText) {
      if (rejected.length) dispatch({ type: 'SKIPPED', names: rejected });
      return;
    }

    dispatch({ type: 'READING', source });
    const items: LocalIntakeItem[] = [];
    // Decode previews one at a time. Running up to sixteen full media decodes
    // concurrently causes avoidable renderer memory pressure and long tasks.
    for (const { file, mimeType } of accepted) {
      let preview;
      try {
        preview = await intakePreview(file, isIntakeVideoMimeType(mimeType));
      } catch {
        rejected.push(file.name || 'media');
        continue;
      }
      items.push({
        id: crypto.randomUUID(),
        kind: 'IMAGE' as const,
        name: file.name || 'media',
        mimeType,
        file,
        previewUrl: preview.url,
        width: preview.width,
        height: preview.height,
        sourceUrl,
      });
    }
    if (wantsText) items.push({ id: crypto.randomUUID(), kind: 'TEXT', text: trimmedText });
    dispatch({ type: 'ADD', source, items, skipped: rejected });
  }

  function onPaste(event: ClipboardEvent) {
    if (!enabled || !event.clipboardData || state.pendingIntent) return;
    const files = clipboardMediaFiles(event.clipboardData).filter((file) => Boolean(intakeMediaMimeType(file)));
    const editable = isEditableTarget(event.target);
    const sourceUrl = files.length ? transferSourceUrl(event.clipboardData) : '';
    const pastedText = editable ? '' : event.clipboardData.getData('text/plain');
    const text = pastedText.trim() === sourceUrl ? '' : pastedText;
    if (!files.length && !text.trim()) return;
    event.preventDefault();
    void add('PASTE', files, text, sourceUrl);
  }

  function onDragEnter(event: React.DragEvent) {
    if (!enabled || state.pendingIntent || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dispatch({ type: 'DRAG_ACTIVE', active: true });
  }

  function onDragOver(event: React.DragEvent) {
    if (!enabled || state.pendingIntent || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event: React.DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    dispatch({ type: 'DRAG_ACTIVE', active: false });
  }

  function onDrop(event: React.DragEvent) {
    if (!enabled || state.pendingIntent || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dispatch({ type: 'DRAG_ACTIVE', active: false });
    const files = [...event.dataTransfer.files].filter((file) => Boolean(intakeMediaMimeType(file)));
    const text = files.length ? '' : event.dataTransfer.getData('text/plain');
    void add('DROP', files, text, files.length ? transferSourceUrl(event.dataTransfer) : '');
  }

  function remove(id: string) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (item?.kind === 'IMAGE') releaseIntakePreview(item.previewUrl);
    dispatch({ type: 'REMOVE', id });
  }

  function reset() {
    for (const item of state.items) if (item.kind === 'IMAGE') releaseIntakePreview(item.previewUrl);
    dispatch({ type: 'RESET' });
  }

  async function commit(intent: IntakeCommitIntent = state.selectedIntent, options: IntakeCommitOptions = {}) {
    if (!state.items.length || state.pendingIntent) return;
    dispatch({ type: 'COMMITTING', intent });
    try {
      const items = [];
      // Bound peak memory and keep Chromium's decode/file tasks schedulable by
      // reading a batch sequentially instead of materializing every file at once.
      for (const item of state.items) {
        items.push(
          item.kind === 'TEXT'
            ? { id: item.id, kind: item.kind, text: item.text }
            : {
                id: item.id,
                kind: item.kind,
                name: item.name,
                mimeType: item.mimeType,
                width: item.width ?? 0,
                height: item.height ?? 0,
                sourceUrl: item.sourceUrl,
                metadata: options.imageDetails?.[item.id]?.metadata,
                relationship: options.imageDetails?.[item.id]?.relationship ?? null,
                bytes: new Uint8Array(await item.file.arrayBuffer()),
              },
        );
      }
      const result = await window.desktopApi.intakeCommit({
        intent,
        source: state.source,
        items,
        favorite: options.favorite ?? state.favorite,
        albumId: options.albumId ?? null,
      });
      reset();
      onCommitted(result);
    } catch (reason) {
      dispatch({ type: 'FAILED', error: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  return {
    state,
    editText: (id: string, text: string) => dispatch({ type: 'EDIT_TEXT', id, text }),
    move: (id: string, offset: -1 | 1) => dispatch({ type: 'MOVE', id, offset }),
    remove,
    reset,
    selectIntent: (intent: IntakeCommitIntent) => dispatch({ type: 'SELECT_INTENT', intent }),
    setFavorite: (favorite: boolean) => dispatch({ type: 'SET_FAVORITE', favorite }),
    cancelDrag: () => dispatch({ type: 'DRAG_ACTIVE', active: false }),
    commit,
    addFiles: (files: File[]) => void add('UPLOAD', files, ''),
    addTransferredFiles: (source: IntakeCommitSource, files: File[], sourceUrl = '') =>
      void add(source, files, '', sourceUrl),
    onPaste,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
