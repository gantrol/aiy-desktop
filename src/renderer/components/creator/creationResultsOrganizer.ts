import type { CreationOutputRelationshipKind, ImportedCreationOutputDto, PromptSeriesDto } from '@/shared/contracts';

export const unchangedOrganizerValue = '__unchanged__';
export const unlinkedOrganizerVersionValue = '__unlinked__';
export const createOrganizerVersionValue = '__create_version__';

export type OrganizerAiGeneratedStatus = ImportedCreationOutputDto['aiGeneratedStatus'];

export interface CreationResultDraftRow {
  output: ImportedCreationOutputDto;
  displayName: string;
  promptVersionId: string | null;
  relationshipKind: CreationOutputRelationshipKind;
  relationshipTargetOutputId: string | null;
  aiGeneratedStatus: OrganizerAiGeneratedStatus;
  modelName: string;
  modelProvider: string;
}

export interface OrganizerVersionOption {
  id: string;
  versionNo: number;
  changeSummary: string;
}

export function organizerRelationRequiresTarget(kind: CreationOutputRelationshipKind) {
  return kind === 'VARIANT' || kind === 'DERIVED' || kind === 'POST_EDIT';
}

export function organizerRelationValue(row: CreationResultDraftRow) {
  if (!organizerRelationRequiresTarget(row.relationshipKind)) return row.relationshipKind;
  return row.relationshipTargetOutputId ? `${row.relationshipKind}:${row.relationshipTargetOutputId}` : 'UNSPECIFIED';
}

export function parseOrganizerRelationValue(value: string): {
  relationshipKind: CreationOutputRelationshipKind;
  relationshipTargetOutputId: string | null;
} {
  const separator = value.indexOf(':');
  if (separator < 0) {
    return {
      relationshipKind: value as CreationOutputRelationshipKind,
      relationshipTargetOutputId: null,
    };
  }
  return {
    relationshipKind: value.slice(0, separator) as CreationOutputRelationshipKind,
    relationshipTargetOutputId: value.slice(separator + 1) || null,
  };
}

function draftRow(output: ImportedCreationOutputDto): CreationResultDraftRow {
  const relationshipKind = output.relationshipKind ?? 'UNSPECIFIED';
  return {
    output,
    displayName: output.displayName,
    promptVersionId: output.promptVersionId,
    relationshipKind:
      organizerRelationRequiresTarget(relationshipKind) && !output.relationshipTargetOutputId
        ? 'UNSPECIFIED'
        : relationshipKind,
    relationshipTargetOutputId: output.relationshipTargetOutputId ?? null,
    aiGeneratedStatus: output.aiGeneratedStatus,
    modelName: output.modelName,
    modelProvider: output.modelProvider,
  };
}

export function creationResultDraftRows(series: PromptSeriesDto) {
  return [...(series.importedOutputs ?? [])]
    .sort(
      (left, right) =>
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    )
    .map(draftRow);
}

function normalizedPrompt(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim().slice(0, 8_000);
}

function promptBigrams(value: string) {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)));
}

function promptSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) >= 20 && (left.includes(right) || right.includes(left))) return 0.9;
  const leftBigrams = promptBigrams(left);
  const rightBigrams = promptBigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;
  let intersection = 0;
  for (const item of leftBigrams) if (rightBigrams.has(item)) intersection += 1;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function inferredVersionId(row: CreationResultDraftRow, series: PromptSeriesDto) {
  if (row.promptVersionId) return row.promptVersionId;
  const generationText = normalizedPrompt(row.output.generationText);
  if (!generationText) return null;
  let best: { id: string; score: number; versionNo: number } | null = null;
  for (const version of series.versions) {
    const candidates = [
      version.finalPrompt,
      version.manualPrompt,
      version.promptInputSnapshot.commonInput.flatPrompt ?? '',
      version.promptInputSnapshot.commonInput.userInstruction,
    ].map(normalizedPrompt);
    const score = Math.max(...candidates.map((candidate) => promptSimilarity(generationText, candidate)));
    if (
      score < 0.72 ||
      (best && (score < best.score || (score === best.score && version.versionNo < best.versionNo)))
    ) {
      continue;
    }
    best = { id: version.id, score, versionNo: version.versionNo };
  }
  return best?.id ?? null;
}

function relationshipGroupKey(row: CreationResultDraftRow) {
  if (row.promptVersionId) return `version:${row.promptVersionId}`;
  const prompt = normalizedPrompt(row.output.generationText);
  return prompt ? `prompt:${prompt}` : null;
}

export function inferCreationResultsFromPrompt(rows: readonly CreationResultDraftRow[], series: PromptSeriesDto) {
  let changedCount = 0;
  const inferred = rows.map((row) => {
    let next = row;
    const promptVersionId = inferredVersionId(row, series);
    if (!row.promptVersionId && promptVersionId) {
      next = { ...next, promptVersionId };
      changedCount += 1;
    }
    const hasGenerationEvidence =
      Boolean(row.modelName.trim()) ||
      (Boolean(row.output.generationText.trim()) &&
        (row.output.generationTextType === 'EXACT_PROMPT' || row.output.generationTextType === 'RECONSTRUCTION'));
    if (next.aiGeneratedStatus === 'UNKNOWN' && hasGenerationEvidence) {
      next = { ...next, aiGeneratedStatus: 'YES' };
      changedCount += 1;
    }
    return next;
  });

  const groups = new Map<string, CreationResultDraftRow[]>();
  for (const row of inferred) {
    const key = relationshipGroupKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const relationshipById = new Map<
    string,
    Pick<CreationResultDraftRow, 'relationshipKind' | 'relationshipTargetOutputId'>
  >();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const primary = group.find((row) => row.relationshipKind === 'PRIMARY') ?? group[0];
    if (primary.relationshipKind === 'UNSPECIFIED') {
      relationshipById.set(primary.output.id, { relationshipKind: 'PRIMARY', relationshipTargetOutputId: null });
    }
    for (const row of group) {
      if (row.output.id === primary.output.id || row.relationshipKind !== 'UNSPECIFIED') continue;
      relationshipById.set(row.output.id, {
        relationshipKind: 'VARIANT',
        relationshipTargetOutputId: primary.output.id,
      });
    }
  }
  return {
    rows: inferred.map((row) => {
      const relationship = relationshipById.get(row.output.id);
      if (!relationship) return row;
      changedCount += 1;
      return { ...row, ...relationship };
    }),
    changedCount,
  };
}
