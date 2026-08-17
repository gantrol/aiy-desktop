import type { VideoDocumentTimedTranscriptContent } from '@/shared/contracts';
import type { VideoKeyChangeModelEvidence } from '@/main/video-documents/key-change-service';
import type {
  VideoDocumentChapterPlanCandidate,
  VideoDocumentClassificationConfidence,
  VideoDocumentProfile,
  VideoDocumentSegmentType,
} from '@/main/video-documents/generation-profile';

const maximumPlanCueCharacters = 60_000;
const maximumPlanCueCount = 500;
const maximumImagesPerTurn = 8;
const maximumChapterEvidenceBoundaryDistanceMs = 2_000;

type TranscriptCue = VideoDocumentTimedTranscriptContent['cues'][number];
type EvidenceCandidate = VideoKeyChangeModelEvidence['candidates'][number];

export interface PlannedSemanticUnit {
  id: string;
  kind: string;
  summary: string;
  supportCueIndexes: number[];
}

export interface PlannedChapter {
  id: string;
  heading: string;
  startCueIndex: number | null;
  endCueIndex: number | null;
  startTimestampMs: number;
  endTimestampMs: number;
  segmentType: VideoDocumentSegmentType;
  classificationConfidence: VideoDocumentClassificationConfidence;
  documentProfile: VideoDocumentProfile;
  semanticUnits: PlannedSemanticUnit[];
}

export interface ChapterDraftWindow {
  id: string;
  chapter: PlannedChapter;
  startTimestampMs: number;
  endTimestampMs: number;
  primaryCues: TranscriptCue[];
  boundaryCues: TranscriptCue[];
  semanticUnits: PlannedSemanticUnit[];
  evidence: VideoKeyChangeModelEvidence;
}

function orchestrationError(message: string) {
  return Object.assign(new Error(message), { code: 'VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID' as const });
}

function cuePromptSize(cue: TranscriptCue) {
  return cue.text.length + 96;
}

export function splitTranscriptForPlanning(transcript: VideoDocumentTimedTranscriptContent) {
  const windows: TranscriptCue[][] = [];
  let current: TranscriptCue[] = [];
  let currentCharacters = 0;
  for (const cue of transcript.cues) {
    const nextCharacters = cuePromptSize(cue);
    if (
      current.length > 0 &&
      (current.length >= maximumPlanCueCount || currentCharacters + nextCharacters > maximumPlanCueCharacters)
    ) {
      windows.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(cue);
    currentCharacters += nextCharacters;
  }
  if (current.length) windows.push(current);
  return windows;
}

export function materializeChapterPlan(
  candidate: VideoDocumentChapterPlanCandidate,
  cues: readonly TranscriptCue[],
  firstChapterOrdinal: number,
) {
  if (!cues.length) throw orchestrationError('A chapter plan cannot be materialized without subtitle cues');
  const cuePositionByIndex = new Map(cues.map((cue, position) => [cue.sourceIndex, position]));
  const materialized: PlannedChapter[] = [];
  let expectedStartPosition = 0;

  for (const [chapterOffset, chapter] of candidate.chapters.entries()) {
    const startPosition = cuePositionByIndex.get(chapter.startCueIndex);
    const endPosition = cuePositionByIndex.get(chapter.endCueIndex);
    if (startPosition === undefined || endPosition === undefined || startPosition !== expectedStartPosition) {
      throw orchestrationError('Codex returned a chapter plan with missing, overlapping, or unknown cue boundaries');
    }
    if (endPosition < startPosition) {
      throw orchestrationError('Codex returned a chapter plan with reversed cue boundaries');
    }
    const chapterCues = cues.slice(startPosition, endPosition + 1);
    const chapterCueIndexes = new Set(chapterCues.map((cue) => cue.sourceIndex));
    const chapterOrdinal = firstChapterOrdinal + chapterOffset;
    const chapterId = `ch-${String(chapterOrdinal).padStart(3, '0')}`;
    const semanticUnits = chapter.necessarySemanticUnits.map((unit, unitOffset) => {
      const supportCueIndexes = [...new Set(unit.supportCueIndexes)];
      if (!supportCueIndexes.length || supportCueIndexes.some((sourceIndex) => !chapterCueIndexes.has(sourceIndex))) {
        throw orchestrationError('Codex returned a semantic unit outside its chapter cue range');
      }
      return {
        id: `${chapterId}-su-${String(unitOffset + 1).padStart(3, '0')}`,
        kind: unit.kind,
        summary: unit.summary,
        supportCueIndexes,
      };
    });
    materialized.push({
      id: chapterId,
      heading: chapter.heading,
      startCueIndex: chapter.startCueIndex,
      endCueIndex: chapter.endCueIndex,
      startTimestampMs: chapterCues[0]!.startTimestampMs,
      endTimestampMs: chapterCues.at(-1)!.endTimestampMs,
      segmentType: chapter.segmentType,
      classificationConfidence: chapter.classificationConfidence,
      documentProfile: candidate.documentProfile,
      semanticUnits,
    });
    expectedStartPosition = endPosition + 1;
  }

  if (expectedStartPosition !== cues.length) {
    throw orchestrationError('Codex returned a chapter plan that does not cover every supplied cue');
  }
  return materialized;
}

function profileForSegmentType(segmentType: VideoDocumentSegmentType): VideoDocumentProfile {
  switch (segmentType) {
    case 'CONCEPT':
      return 'STUDY_NOTE';
    case 'PROCEDURE':
      return 'STEP_GUIDE';
    case 'ARGUMENT':
      return 'DECISION_BRIEF';
    case 'NARRATIVE':
      return 'SPOILER_FREE_STORY_CARD';
    case 'EVENT':
      return 'EVENT_TIMELINE';
    case 'PERFORMANCE':
      return 'PERFORMANCE_COMPANION';
    case 'CONVERSATION':
      return 'THEMATIC_RECORD';
    case 'EXPLORATION':
      return 'FIELD_NOTES';
    case 'ORIGINAL_LED':
      return 'ORIGINAL_LED';
  }
}

export function chooseDocumentProfile(
  chapters: readonly Pick<PlannedChapter, 'segmentType' | 'startTimestampMs' | 'endTimestampMs'>[],
  proposedProfiles: readonly VideoDocumentProfile[],
) {
  const distinctProfiles = [...new Set(proposedProfiles)];
  if (distinctProfiles.length === 1) return distinctProfiles[0]!;
  const durationByType = new Map<VideoDocumentSegmentType, number>();
  for (const chapter of chapters) {
    durationByType.set(
      chapter.segmentType,
      (durationByType.get(chapter.segmentType) ?? 0) + Math.max(1, chapter.endTimestampMs - chapter.startTimestampMs),
    );
  }
  const dominant = [...durationByType.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0];
  return dominant ? profileForSegmentType(dominant) : 'ORIGINAL_LED';
}

export function lowestClassificationConfidence(
  values: readonly VideoDocumentClassificationConfidence[],
): VideoDocumentClassificationConfidence {
  if (values.includes('LOW')) return 'LOW';
  return values.includes('MEDIUM') ? 'MEDIUM' : 'HIGH';
}

function midpoint(left: number, right: number) {
  return Math.floor(left + (right - left) / 2);
}

function windowIndexForTimestamp(timestampMs: number, boundaries: readonly number[]) {
  const windowCount = boundaries.length - 1;
  for (let index = 0; index < windowCount; index += 1) {
    if (index === windowCount - 1 || timestampMs < boundaries[index + 1]!) return index;
  }
  return Math.max(0, windowCount - 1);
}

function chunkCandidates(candidates: readonly EvidenceCandidate[]) {
  const chunks: EvidenceCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += maximumImagesPerTurn) {
    chunks.push(candidates.slice(index, index + maximumImagesPerTurn));
  }
  return chunks;
}

function evidenceFor(
  evidence: VideoKeyChangeModelEvidence,
  candidates: EvidenceCandidate[],
): VideoKeyChangeModelEvidence {
  return { ...evidence, candidates };
}

function chapterEvidenceCandidates(chapter: PlannedChapter, evidence: VideoKeyChangeModelEvidence) {
  const inRange = evidence.candidates.filter(
    (candidate) => candidate.timestampMs >= chapter.startTimestampMs && candidate.timestampMs <= chapter.endTimestampMs,
  );
  if (inRange.length) return inRange;

  const before = evidence.candidates
    .filter(
      (candidate) =>
        candidate.timestampMs < chapter.startTimestampMs &&
        chapter.startTimestampMs - candidate.timestampMs <= maximumChapterEvidenceBoundaryDistanceMs,
    )
    .sort((left, right) => right.timestampMs - left.timestampMs || left.id.localeCompare(right.id))[0];
  const after = evidence.candidates
    .filter(
      (candidate) =>
        candidate.timestampMs > chapter.endTimestampMs &&
        candidate.timestampMs - chapter.endTimestampMs <= maximumChapterEvidenceBoundaryDistanceMs,
    )
    .sort((left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id))[0];
  return [...new Map([before, after].filter(Boolean).map((candidate) => [candidate!.id, candidate!])).values()].sort(
    (left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id),
  );
}

export function createChapterDraftWindows(input: {
  chapter: PlannedChapter;
  transcriptCues: readonly TranscriptCue[];
  evidence: VideoKeyChangeModelEvidence;
}): ChapterDraftWindow[] {
  const cuePosition = new Map(input.transcriptCues.map((cue, index) => [cue.sourceIndex, index]));
  const startCuePosition =
    input.chapter.startCueIndex === null ? undefined : cuePosition.get(input.chapter.startCueIndex);
  const endCuePosition = input.chapter.endCueIndex === null ? undefined : cuePosition.get(input.chapter.endCueIndex);
  if (startCuePosition === undefined || endCuePosition === undefined || endCuePosition < startCuePosition) {
    throw orchestrationError('A planned chapter no longer matches the transcript snapshot');
  }
  const chapterCues = input.transcriptCues.slice(startCuePosition, endCuePosition + 1);
  const chapterCandidates = chapterEvidenceCandidates(input.chapter, input.evidence);
  const candidateChunks = chunkCandidates(chapterCandidates);
  if (!candidateChunks.length) candidateChunks.push([]);
  const boundaries = [input.chapter.startTimestampMs];
  for (let index = 0; index < candidateChunks.length - 1; index += 1) {
    const leftTimestampMs = candidateChunks[index]!.at(-1)!.timestampMs;
    const rightTimestampMs = candidateChunks[index + 1]![0]!.timestampMs;
    const targetTimestampMs = midpoint(leftTimestampMs, rightTimestampMs);
    const cueBoundary = chapterCues
      .map((cue) => cue.startTimestampMs)
      .filter((timestampMs) => timestampMs > leftTimestampMs && timestampMs <= rightTimestampMs)
      .sort(
        (left, right) => Math.abs(left - targetTimestampMs) - Math.abs(right - targetTimestampMs) || left - right,
      )[0];
    boundaries.push(cueBoundary ?? targetTimestampMs);
  }
  boundaries.push(input.chapter.endTimestampMs);

  const unitWindow = new Map<string, number>();
  for (const unit of input.chapter.semanticUnits) {
    const anchorIndex = unit.supportCueIndexes[0]!;
    const anchorCue = input.transcriptCues[cuePosition.get(anchorIndex) ?? -1];
    const windowIndex = windowIndexForTimestamp(
      anchorCue?.startTimestampMs ?? input.chapter.startTimestampMs,
      boundaries,
    );
    unitWindow.set(unit.id, windowIndex);
  }

  return candidateChunks.map((candidates, windowIndex) => {
    const startTimestampMs = boundaries[windowIndex]!;
    const endTimestampMs = boundaries[windowIndex + 1]!;
    const primaryCues = chapterCues.filter(
      (cue) => windowIndexForTimestamp(cue.startTimestampMs, boundaries) === windowIndex,
    );
    const primaryIndexes = new Set(primaryCues.map((cue) => cue.sourceIndex));
    const firstPosition = primaryCues.length ? cuePosition.get(primaryCues[0]!.sourceIndex) : undefined;
    const lastPosition = primaryCues.length ? cuePosition.get(primaryCues.at(-1)!.sourceIndex) : undefined;
    const boundaryCues = [
      firstPosition !== undefined ? input.transcriptCues[firstPosition - 1] : undefined,
      lastPosition !== undefined ? input.transcriptCues[lastPosition + 1] : undefined,
    ].filter((cue): cue is TranscriptCue => cue !== undefined && !primaryIndexes.has(cue.sourceIndex));
    return {
      id: `${input.chapter.id}-window-${String(windowIndex + 1).padStart(2, '0')}`,
      chapter: input.chapter,
      startTimestampMs,
      endTimestampMs,
      primaryCues,
      boundaryCues,
      semanticUnits: input.chapter.semanticUnits.filter((unit) => unitWindow.get(unit.id) === windowIndex),
      evidence: evidenceFor(input.evidence, candidates),
    };
  });
}

export function createVisualOnlyDraftWindows(
  durationMs: number,
  evidence: VideoKeyChangeModelEvidence,
): ChapterDraftWindow[] {
  const candidateChunks = chunkCandidates(evidence.candidates);
  if (!candidateChunks.length) throw orchestrationError('Visual-only generation requires source frames');
  const boundaries = [0];
  for (let index = 0; index < candidateChunks.length - 1; index += 1) {
    boundaries.push(midpoint(candidateChunks[index]!.at(-1)!.timestampMs, candidateChunks[index + 1]![0]!.timestampMs));
  }
  boundaries.push(durationMs);
  return candidateChunks.map((candidates, index) => {
    const startTimestampMs = boundaries[index]!;
    const endTimestampMs = boundaries[index + 1]!;
    const chapter: PlannedChapter = {
      id: `visual-window-${String(index + 1).padStart(3, '0')}`,
      heading: `${startTimestampMs}-${endTimestampMs}`,
      startCueIndex: null,
      endCueIndex: null,
      startTimestampMs,
      endTimestampMs,
      segmentType: 'ORIGINAL_LED',
      classificationConfidence: 'LOW',
      documentProfile: 'ORIGINAL_LED',
      semanticUnits: [],
    };
    return {
      id: `${chapter.id}-window-01`,
      chapter,
      startTimestampMs,
      endTimestampMs,
      primaryCues: [],
      boundaryCues: [],
      semanticUnits: [],
      evidence: evidenceFor(evidence, candidates),
    };
  });
}
