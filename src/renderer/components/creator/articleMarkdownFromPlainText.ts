const markdownListItemPattern = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/u;
const markdownListContinuationPattern = /^(?: {2,}|\t)/u;
const markdownThematicBreakPattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u;
const markdownFencePattern = /^ {0,3}(`{3,}|~{3,})/u;

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

function fenceAt(line: string): MarkdownFence | null {
  const match = line.match(markdownFencePattern);
  const marker = match?.[1];
  if (!marker) return null;
  return { marker: marker[0] as MarkdownFence['marker'], length: marker.length };
}

function closesFence(line: string, fence: MarkdownFence) {
  const candidate = line.trim();
  return candidate.length >= fence.length && candidate.split('').every((character) => character === fence.marker);
}

function appendBlankLine(lines: string[]) {
  if (lines.length && lines.at(-1) !== '') lines.push('');
}

/**
 * The creator input is a plain-text paragraph editor, while articles consume
 * Markdown. Make ambiguous block boundaries explicit before Markdown parsing
 * so prose after a list cannot become a lazy continuation of its final item.
 */
export function articleMarkdownFromPlainText(value: string) {
  const sourceLines = value.replace(/\r\n?/gu, '\n').trim().split('\n');
  if (sourceLines.length === 1 && !sourceLines[0]) return '';

  const markdownLines: string[] = [];
  let fence: MarkdownFence | null = null;

  sourceLines.forEach((line, index) => {
    const previous = sourceLines[index - 1];
    const startsFence = fence ? null : fenceAt(line);
    const thematicBreak = !fence && !startsFence && markdownThematicBreakPattern.test(line);
    const listItem = !fence && !startsFence && !thematicBreak && markdownListItemPattern.test(line);

    if (
      !fence &&
      line.trim() &&
      previous?.trim() &&
      ((listItem && !markdownListItemPattern.test(previous) && !markdownListContinuationPattern.test(previous)) ||
        thematicBreak)
    ) {
      appendBlankLine(markdownLines);
    }

    markdownLines.push(line);

    if (fence) {
      if (closesFence(line, fence)) fence = null;
      return;
    }
    if (startsFence) {
      fence = startsFence;
      return;
    }

    const next = sourceLines[index + 1];
    if (!next?.trim()) return;
    if (thematicBreak) {
      appendBlankLine(markdownLines);
      return;
    }
    if (listItem && !markdownListItemPattern.test(next) && !markdownListContinuationPattern.test(next)) {
      appendBlankLine(markdownLines);
    }
  });

  return markdownLines.join('\n').trim();
}
