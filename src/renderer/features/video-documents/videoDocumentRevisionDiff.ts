import type { VideoDocumentRevisionContent } from '@/shared/contracts';

const MAX_DIFF_WORK = 200_000;

export interface VideoDocumentRevisionDiffSummary {
  addedLines: number;
  removedLines: number;
}

function revisionText(content: VideoDocumentRevisionContent) {
  if (content.format === 'MARKDOWN') return content.markdown;
  if (content.format === 'NOTE_COLLECTION') {
    return content.notes
      .map((note) => [`@note:${note.id}`, `@title:${note.title}`, note.markdown].join('\n'))
      .join('\n\n');
  }
  return JSON.stringify(content, null, 2);
}

function textLines(content: VideoDocumentRevisionContent) {
  const text = revisionText(content).replace(/\r\n?/g, '\n');
  return text ? text.split('\n') : [];
}

function boundedFallback(previous: readonly string[], current: readonly string[]): VideoDocumentRevisionDiffSummary {
  let prefix = 0;
  while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < current.length - prefix &&
    previous[previous.length - suffix - 1] === current[current.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    addedLines: current.length - prefix - suffix,
    removedLines: previous.length - prefix - suffix,
  };
}

/** Exact Myers line-distance counts with a bounded fallback for unusually large rewrites. */
export function summarizeVideoDocumentRevisionDiff(
  previousContent: VideoDocumentRevisionContent,
  currentContent: VideoDocumentRevisionContent,
): VideoDocumentRevisionDiffSummary {
  const previous = textLines(previousContent);
  const current = textLines(currentContent);
  if (!previous.length) return { addedLines: current.length, removedLines: 0 };
  if (!current.length) return { addedLines: 0, removedLines: previous.length };

  const maxDistance = previous.length + current.length;
  const furthestX = new Map<number, number>([[1, 0]]);
  let work = 0;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_DIFF_WORK) return boundedFallback(previous, current);

      const deletionX = furthestX.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      const insertionX = furthestX.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      let x =
        diagonal === -distance || (diagonal !== distance && deletionX < insertionX)
          ? Math.max(0, insertionX)
          : Math.max(0, deletionX) + 1;
      let y = x - diagonal;

      while (x < previous.length && y < current.length && previous[x] === current[y]) {
        x += 1;
        y += 1;
        work += 1;
        if (work > MAX_DIFF_WORK) return boundedFallback(previous, current);
      }
      furthestX.set(diagonal, x);

      if (x >= previous.length && y >= current.length) {
        return {
          addedLines: (distance - diagonal) / 2,
          removedLines: (distance + diagonal) / 2,
        };
      }
    }
  }

  return boundedFallback(previous, current);
}
