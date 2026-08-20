import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedCreationOutputDto, PromptSeriesDto, PromptVersionCreateResult } from '@/shared/contracts';
import {
  creationResultDraftRows,
  inferCreationResultsFromPrompt,
  type CreationResultDraftRow,
  type OrganizerAiGeneratedStatus,
  type OrganizerVersionOption,
  unchangedOrganizerValue,
  unlinkedOrganizerVersionValue,
} from '@/renderer/components/creator/creationResultsOrganizer';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  open: boolean;
  series: PromptSeriesDto | null;
  initialOutputId: string | null;
  onCreateVersion(seriesId: string): Promise<PromptVersionCreateResult | null>;
  onSaved(outputs: ImportedCreationOutputDto[]): Promise<void>;
  onClose(): void;
  notify(message: string): void;
}

export function useCreationResultsOrganizer({
  open,
  series,
  initialOutputId,
  onCreateVersion,
  onSaved,
  onClose,
  notify,
}: Options) {
  const labels = useI18n().messages.creator.resultsOrganizer;
  const initializedSeriesId = useRef<string | null>(null);
  const [rows, setRows] = useState<CreationResultDraftRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchVersionValue, setBatchVersionValue] = useState(unchangedOrganizerValue);
  const [batchAiValue, setBatchAiValue] = useState<typeof unchangedOrganizerValue | OrganizerAiGeneratedStatus>(
    unchangedOrganizerValue,
  );
  const [createdVersions, setCreatedVersions] = useState<OrganizerVersionOption[]>([]);
  const [versionCreating, setVersionCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      initializedSeriesId.current = null;
      return;
    }
    if (!series || initializedSeriesId.current === series.id) return;
    initializedSeriesId.current = series.id;
    const nextRows = creationResultDraftRows(series);
    setRows(nextRows);
    setSelectedIds(
      initialOutputId && nextRows.some((row) => row.output.id === initialOutputId)
        ? new Set([initialOutputId])
        : new Set(),
    );
    setBatchVersionValue(unchangedOrganizerValue);
    setBatchAiValue(unchangedOrganizerValue);
    setCreatedVersions([]);
  }, [initialOutputId, open, series]);

  const versions = useMemo(() => {
    const byId = new Map<string, OrganizerVersionOption>();
    for (const version of series?.versions ?? []) {
      byId.set(version.id, {
        id: version.id,
        versionNo: version.versionNo,
        changeSummary: version.changeSummary,
      });
    }
    for (const version of createdVersions) if (!byId.has(version.id)) byId.set(version.id, version);
    return [...byId.values()].sort(
      (left, right) => left.versionNo - right.versionNo || left.id.localeCompare(right.id),
    );
  }, [createdVersions, series?.versions]);
  const nextVersionNo = Math.max(0, ...versions.map((version) => version.versionNo)) + 1;
  const nextVersionLabel = `V${String(nextVersionNo).padStart(2, '0')}`;
  const someSelected = rows.some((row) => selectedIds.has(row.output.id));
  const invalid = rows.some((row) => !row.displayName.trim());
  const busy = saving || versionCreating;

  function updateRow(outputId: string, update: Partial<Omit<CreationResultDraftRow, 'output'>>) {
    setRows((current) => current.map((row) => (row.output.id === outputId ? { ...row, ...update } : row)));
  }

  function updateAllRows(update: Partial<Omit<CreationResultDraftRow, 'output'>>) {
    setRows((current) =>
      current.map((row) => {
        const next = { ...row, ...update };
        if (next.aiGeneratedStatus === 'NO') {
          next.modelName = '';
          next.modelProvider = '';
        } else if (update.modelName?.trim() && next.aiGeneratedStatus === 'UNKNOWN') {
          next.aiGeneratedStatus = 'YES';
        }
        return next;
      }),
    );
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(rows.map((row) => row.output.id)) : new Set());
  }

  function toggleRow(outputId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(outputId);
      else next.delete(outputId);
      return next;
    });
  }

  function moveRow(outputId: string, direction: -1 | 1) {
    setRows((current) => {
      const index = current.findIndex((row) => row.output.id === outputId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  async function createVersion(assignOutputIds: readonly string[]) {
    if (!series || versionCreating || saving) return null;
    const versionNo = nextVersionNo;
    setVersionCreating(true);
    try {
      const result = await onCreateVersion(series.id);
      if (!result || result.seriesId !== series.id) return null;
      setCreatedVersions((current) => [
        ...current.filter((version) => version.id !== result.versionId),
        { id: result.versionId, versionNo, changeSummary: '' },
      ]);
      const assignIds = new Set(assignOutputIds);
      if (assignIds.size) {
        setRows((current) =>
          current.map((row) => (assignIds.has(row.output.id) ? { ...row, promptVersionId: result.versionId } : row)),
        );
      }
      return result.versionId;
    } finally {
      setVersionCreating(false);
    }
  }

  function applyBatchValues() {
    if (!someSelected) return;
    setRows((current) =>
      current.map((row) => {
        if (!selectedIds.has(row.output.id)) return row;
        const next = { ...row };
        if (batchVersionValue !== unchangedOrganizerValue) {
          next.promptVersionId = batchVersionValue === unlinkedOrganizerVersionValue ? null : batchVersionValue;
        }
        if (batchAiValue !== unchangedOrganizerValue) {
          next.aiGeneratedStatus = batchAiValue;
          if (batchAiValue === 'NO') {
            next.modelName = '';
            next.modelProvider = '';
          }
        }
        return next;
      }),
    );
  }

  function inferFromPrompt() {
    if (!series || busy) return;
    const result = inferCreationResultsFromPrompt(rows, series);
    setRows(result.rows);
    notify(result.changedCount ? labels.inferred(result.changedCount) : labels.nothingInferred);
  }

  async function save() {
    if (!series || busy || invalid || !rows.length) return;
    if (typeof window.desktopApi.creatorOutputsOrganize !== 'function') {
      notify(labels.restartRequired);
      return;
    }
    setSaving(true);
    try {
      const result = await window.desktopApi.creatorOutputsOrganize({
        seriesId: series.id,
        items: rows.map((row) => ({
          outputId: row.output.id,
          displayName: row.displayName,
          promptVersionId: row.promptVersionId,
          relationshipKind: row.relationshipKind,
          relationshipTargetOutputId: row.relationshipTargetOutputId,
          aiGeneratedStatus: row.aiGeneratedStatus,
          modelName: row.modelName,
          modelProvider: row.modelProvider,
        })),
      });
      await onSaved(result.outputs);
      notify(labels.saved);
      onClose();
    } catch (reason) {
      notify(`${labels.saveFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setSaving(false);
    }
  }

  return {
    rows,
    selectedIds,
    batchVersionValue,
    setBatchVersionValue,
    batchAiValue,
    setBatchAiValue,
    versions,
    nextVersionLabel,
    someSelected,
    invalid,
    busy,
    saving,
    versionCreating,
    updateRow,
    updateAllRows,
    toggleAll,
    toggleRow,
    moveRow,
    createVersion,
    applyBatchValues,
    inferFromPrompt,
    save,
  };
}
