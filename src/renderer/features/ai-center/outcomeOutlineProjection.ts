import type { AssetDto, BootstrapDto } from '@/shared/contracts';
import type { AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';

export type AiActivityOutcomeKind = 'CREATION' | 'DOCUMENT' | 'DRAFT' | 'UNASSIGNED';

export interface AiActivityOutlineNode {
  record: AiActivityRecord;
  children: AiActivityOutlineNode[];
}

export interface AiActivityOutcomeGroup {
  id: string;
  kind: AiActivityOutcomeKind;
  title: string | null;
  cover: AssetDto | null;
  latestAt: string;
  recordCount: number;
  nodes: AiActivityOutlineNode[];
}

type AiActivityOutlineContext = Pick<BootstrapDto, 'creationDraft' | 'creations'>;

interface OutcomeReference {
  id: string;
  kind: AiActivityOutcomeKind;
  title: string | null;
  cover: AssetDto | null;
}

function activityScope(record: AiActivityRecord) {
  if (record.kind === 'ASSISTANT') return record.run.scope;
  if (record.kind === 'EXPERIMENT') return record.batch.scope;
  return null;
}

function outcomeReference(
  record: AiActivityRecord,
  context: AiActivityOutlineContext,
  creationTitleById: ReadonlyMap<string, string>,
): OutcomeReference {
  if (record.kind === 'VIDEO_DOCUMENT') {
    return {
      id: `document:${record.activity.run.documentId}`,
      kind: 'DOCUMENT',
      title: record.activity.documentTitle,
      cover: null,
    };
  }

  const ideaCreation =
    record.kind === 'ASSISTANT'
      ? record.run.creationId
        ? { id: record.run.creationId, title: record.run.creationTitle }
        : null
      : record.kind === 'EXPERIMENT' && record.sourceRun?.creationId
        ? { id: record.sourceRun.creationId, title: record.sourceRun.creationTitle }
        : null;
  if (ideaCreation) {
    return {
      id: `creation:${ideaCreation.id}`,
      kind: 'CREATION',
      title: creationTitleById.get(ideaCreation.id) ?? ideaCreation.title ?? null,
      cover: record.sourceSeries?.cover ?? null,
    };
  }

  if (record.sourceSeries) {
    return {
      id: `series:${record.sourceSeries.id}`,
      kind: 'CREATION',
      title: record.sourceSeries.title,
      cover: record.sourceSeries.cover,
    };
  }

  const scope = activityScope(record);
  if (scope?.kind === 'SERIES') {
    return { id: `series:${scope.id}`, kind: 'CREATION', title: null, cover: null };
  }
  if (scope?.kind === 'DRAFT') {
    const currentDraft = context.creationDraft?.id === scope.id ? context.creationDraft : null;
    return {
      id: `draft:${scope.id}`,
      kind: 'DRAFT',
      title: currentDraft?.title.trim() || null,
      cover: currentDraft?.referenceAssets[0] ?? null,
    };
  }

  return { id: 'unassigned', kind: 'UNASSIGNED', title: null, cover: null };
}

function parentRecordId(
  record: AiActivityRecord,
  assistantByProposalId: ReadonlyMap<string, AiActivityRecord>,
  experimentBySlotId: ReadonlyMap<string, AiActivityRecord>,
  generationByAssetId: ReadonlyMap<string, AiActivityRecord>,
  videoByRevisionId: ReadonlyMap<string, AiActivityRecord>,
) {
  if (record.kind === 'EXPERIMENT') return `assistant:${record.batch.sourceAssistantRunId}`;

  if (record.kind === 'ASSISTANT') {
    const sourceSlotId = record.run.input.sourceExperimentSlotId;
    if (sourceSlotId) return experimentBySlotId.get(sourceSlotId)?.id ?? null;
    const parentProposalId = record.run.input.parentProposalId;
    return parentProposalId ? (assistantByProposalId.get(parentProposalId)?.id ?? null) : null;
  }

  if (record.kind === 'GENERATION') {
    if (record.run.retryOfRunId) return `generation:${record.run.retryOfRunId}`;
    const sourceAssetId = record.run.derivation?.sourceAssetId ?? record.version.sourceImageId;
    return sourceAssetId ? (generationByAssetId.get(sourceAssetId)?.id ?? null) : null;
  }

  if (
    (record.activity.type === 'ARTICLE_GENERATION' || record.activity.type === 'TRANSCRIPT_TRANSLATION') &&
    record.activity.run.inputRevisionId
  ) {
    return videoByRevisionId.get(record.activity.run.inputRevisionId)?.id ?? null;
  }
  return null;
}

function comesBefore(parent: AiActivityRecord, child: AiActivityRecord) {
  return parent.createdAt < child.createdAt || (parent.createdAt === child.createdAt && parent.id < child.id);
}

function outlineNodes(records: readonly AiActivityRecord[]): AiActivityOutlineNode[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const assistantByProposalId = new Map<string, AiActivityRecord>();
  const experimentBySlotId = new Map<string, AiActivityRecord>();
  const generationByAssetId = new Map<string, AiActivityRecord>();
  const videoByRevisionId = new Map<string, AiActivityRecord>();

  for (const record of records) {
    if (record.kind === 'ASSISTANT' && record.run.proposal) {
      assistantByProposalId.set(record.run.proposal.id, record);
    } else if (record.kind === 'EXPERIMENT') {
      for (const slot of record.batch.slots) experimentBySlotId.set(slot.id, record);
    } else if (record.kind === 'GENERATION' && record.run.asset) {
      generationByAssetId.set(record.run.asset.id, record);
    } else if (record.kind === 'VIDEO_DOCUMENT' && record.activity.run.outputRevisionId) {
      videoByRevisionId.set(record.activity.run.outputRevisionId, record);
    }
  }

  const nodeById = new Map<string, AiActivityOutlineNode>(
    records.map((record) => [record.id, { record, children: [] }]),
  );
  const childIds = new Set<string>();

  for (const record of records) {
    const candidateId = parentRecordId(
      record,
      assistantByProposalId,
      experimentBySlotId,
      generationByAssetId,
      videoByRevisionId,
    );
    if (!candidateId || candidateId === record.id) continue;
    const parentRecord = recordById.get(candidateId);
    const parentNode = nodeById.get(candidateId);
    const childNode = nodeById.get(record.id);
    if (!parentRecord || !parentNode || !childNode || !comesBefore(parentRecord, record)) continue;
    parentNode.children.push(childNode);
    childIds.add(record.id);
  }

  function sortChildren(node: AiActivityOutlineNode) {
    node.children.sort(
      (left, right) =>
        left.record.createdAt.localeCompare(right.record.createdAt) || left.record.id.localeCompare(right.record.id),
    );
    for (const child of node.children) sortChildren(child);
  }

  const roots = records
    .filter((record) => !childIds.has(record.id))
    .map((record) => nodeById.get(record.id)!)
    .sort(
      (left, right) =>
        right.record.createdAt.localeCompare(left.record.createdAt) || right.record.id.localeCompare(left.record.id),
    );
  for (const root of roots) sortChildren(root);
  return roots;
}

export function projectAiActivityOutcomeOutline(
  records: readonly AiActivityRecord[],
  context: AiActivityOutlineContext,
  lineageRecords: readonly AiActivityRecord[] = records,
): AiActivityOutcomeGroup[] {
  const creationTitleById = new Map((context.creations ?? []).map((creation) => [creation.id, creation.title]));
  const assistantByProposalId = new Map<string, AiActivityRecord>();
  const experimentBySlotId = new Map<string, AiActivityRecord>();
  for (const record of lineageRecords) {
    if (record.kind === 'ASSISTANT' && record.run.proposal) {
      assistantByProposalId.set(record.run.proposal.id, record);
    } else if (record.kind === 'EXPERIMENT') {
      for (const slot of record.batch.slots) experimentBySlotId.set(slot.id, record);
    }
  }
  const referenceByRecordId = new Map<string, OutcomeReference>();

  function resolvedReference(record: AiActivityRecord, ancestors = new Set<string>()): OutcomeReference {
    const cached = referenceByRecordId.get(record.id);
    if (cached) return cached;
    const nextAncestors = new Set(ancestors).add(record.id);
    const explicitParent =
      record.kind === 'ASSISTANT' && !record.run.creationId
        ? record.run.input.sourceExperimentSlotId
          ? experimentBySlotId.get(record.run.input.sourceExperimentSlotId)
          : record.run.input.parentProposalId
            ? assistantByProposalId.get(record.run.input.parentProposalId)
            : undefined
        : undefined;
    const reference =
      explicitParent && !nextAncestors.has(explicitParent.id)
        ? resolvedReference(explicitParent, nextAncestors)
        : outcomeReference(record, context, creationTitleById);
    referenceByRecordId.set(record.id, reference);
    return reference;
  }

  const grouped = new Map<string, { reference: OutcomeReference; records: AiActivityRecord[] }>();

  for (const record of records) {
    const reference = resolvedReference(record);
    const existing = grouped.get(reference.id);
    if (existing) {
      existing.records.push(record);
      if (!existing.reference.title && reference.title) existing.reference.title = reference.title;
      if (!existing.reference.cover && reference.cover) existing.reference.cover = reference.cover;
    } else grouped.set(reference.id, { reference, records: [record] });
  }

  return [...grouped.values()]
    .map(({ reference, records: groupRecords }): AiActivityOutcomeGroup => {
      const latestAt = groupRecords.reduce(
        (latest, record) => (record.createdAt > latest ? record.createdAt : latest),
        groupRecords[0]?.createdAt ?? '',
      );
      return {
        ...reference,
        latestAt,
        recordCount: groupRecords.length,
        nodes: outlineNodes(groupRecords),
      };
    })
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt) || left.id.localeCompare(right.id));
}
