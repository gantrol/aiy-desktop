import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalIntakeItem } from '@/renderer/features/intake/intake-state';
import {
  applyIntakeBatchFields,
  createIntakeImageMetadataDraft,
  defaultBatchMetadataFields,
  mergeIntakeImageMetadataDraft,
  type BatchMetadataField,
  type IntakeImageMetadataDraft,
  type IntakeImageMetadataDraftUpdate,
} from '@/renderer/features/intake/importMetadata';

export type ImportOrganizerMediaItem = Exclude<LocalIntakeItem, { kind: 'TEXT' }>;

export function useImportMetadataOrganizer(items: readonly ImportOrganizerMediaItem[]) {
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const knownIds = useRef(new Set<string>());
  const [drafts, setDrafts] = useState<Record<string, IntakeImageMetadataDraft>>(() =>
    Object.fromEntries(items.map((item) => [item.id, createIntakeImageMetadataDraft(item)])),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchDraft, setBatchDraft] = useState<IntakeImageMetadataDraft | null>(null);
  const [batchFields, setBatchFields] = useState<Set<BatchMetadataField>>(() => new Set(defaultBatchMetadataFields));

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, IntakeImageMetadataDraft> = {};
      for (const item of items) next[item.id] = current[item.id] ?? createIntakeImageMetadataDraft(item);
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => itemIds.has(id)));
      for (const id of itemIds) if (!knownIds.current.has(id)) next.add(id);
      return next;
    });
    knownIds.current = itemIds;
    setEditingId((current) => (current && itemIds.has(current) ? current : null));
  }, [itemIds, items]);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const editingItem = editingId ? items.find((item) => item.id === editingId) : undefined;
  const editorDraft = batchMode ? batchDraft : editingItem ? drafts[editingItem.id] : undefined;

  useEffect(() => {
    if (selectedItems.length >= 2 || !batchMode) return;
    setBatchMode(false);
    setBatchDraft(null);
  }, [batchMode, selectedItems.length]);

  function updateRow(id: string, update: IntakeImageMetadataDraftUpdate) {
    setDrafts((current) => {
      const draft = current[id];
      return draft ? { ...current, [id]: mergeIntakeImageMetadataDraft(draft, update) } : current;
    });
  }

  function updateAll(update: IntakeImageMetadataDraftUpdate) {
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, draft]) => [id, mergeIntakeImageMetadataDraft(draft, update)]),
      ),
    );
  }

  function toggle(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openDetails(id: string) {
    setBatchMode(false);
    setBatchDraft(null);
    setEditingId(id);
  }

  function closeDetails() {
    setEditingId(null);
    setBatchMode(false);
    setBatchDraft(null);
  }

  function exitBatch() {
    setBatchMode(false);
    setBatchDraft(null);
  }

  function enterBatch(preferredId = editingId) {
    const sourceId = preferredId && selectedIds.has(preferredId) ? preferredId : selectedItems[0]?.id;
    const source = sourceId ? drafts[sourceId] : undefined;
    if (!source || selectedItems.length < 2) return;
    setEditingId(sourceId);
    setBatchDraft({ ...source });
    setBatchFields(new Set(defaultBatchMetadataFields));
    setBatchMode(true);
  }

  function applyBatch(relationshipEnabled: boolean) {
    if (!batchDraft || selectedItems.length < 1) return;
    const applicableFields = relationshipEnabled
      ? batchFields
      : new Set([...batchFields].filter((field) => field !== 'seriesId' && field !== 'promptVersionId'));
    const selected = new Set(selectedItems.map((item) => item.id));
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, draft]) => [
          id,
          selected.has(id) ? applyIntakeBatchFields(draft, batchDraft, applicableFields) : draft,
        ]),
      ),
    );
    closeDetails();
  }

  function reset() {
    knownIds.current = new Set();
    setDrafts({});
    setSelectedIds(new Set());
    closeDetails();
  }

  return {
    drafts,
    selectedIds,
    selectedItems,
    editingItem,
    editorDraft,
    batchMode,
    batchDraft,
    batchFields,
    detailsOpen: batchMode || Boolean(editingItem),
    setBatchDraft,
    setBatchFields,
    updateRow,
    updateAll,
    toggle,
    selectAll: (selected: boolean) => setSelectedIds(selected ? new Set(items.map((item) => item.id)) : new Set()),
    openDetails,
    closeDetails,
    exitBatch,
    enterBatch,
    applyBatch,
    reset,
  };
}
