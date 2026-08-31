interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

const emptyListItemPattern = /^[\t ]*(?:[-+*]|\d{1,9}[.)])[\t ]*$/u;
const listItemPattern = /^[\t ]*(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$)/u;
const explicitEmptyParagraphPattern = /^[\t ]*(?:&nbsp;|\u00a0)[\t ]*$/u;
const markdownHardBreakPattern = / {2,}$/u;
const escapedStrongPattern = /\\\*\\\*(?![\s*])((?:(?!\\\*\\\*)[^\r\n])*?[^\s])\\\*\\\*/gu;

/** Recover paired strong markers that an earlier WYSIWYG round trip persisted as literal text. */
function recoverEscapedStrongMarks(value: string) {
  return value.replace(escapedStrongPattern, '**$1**');
}

function trimDocumentEdgeEmptyParagraphs(lines: readonly string[]) {
  let start = 0;
  let end = lines.length;
  while (start < end && (!lines[start]!.trim() || explicitEmptyParagraphPattern.test(lines[start]!))) start += 1;
  while (end > start && (!lines[end - 1]!.trim() || explicitEmptyParagraphPattern.test(lines[end - 1]!))) end -= 1;
  return lines.slice(start, end);
}

function openingFence(line: string): MarkdownFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return null;
  const run = match[1]!;
  const marker = run[0] as MarkdownFence['marker'];
  if (marker === '`' && match[2]?.includes('`')) return null;
  return { marker, length: run.length };
}

function closesFence(line: string, fence: MarkdownFence) {
  const match = /^ {0,3}(`{3,}|~{3,})[\t ]*$/u.exec(line);
  if (!match) return false;
  const run = match[1]!;
  return run[0] === fence.marker && run.length >= fence.length;
}

function nextNonBlankLineIsListItem(lines: readonly string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    return listItemPattern.test(line);
  }
  return false;
}

function closingDelimiterIndex(value: string, startIndex: number, opening: '[' | '(', closing: ']' | ')') {
  if (value[startIndex] !== opening) return -1;

  let depth = 0;
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === opening) {
      depth += 1;
      continue;
    }
    if (character !== closing) continue;
    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function isStandaloneMarkdownImage(line: string) {
  const value = line.trim();
  if (!value.startsWith('![')) return false;

  const labelEnd = closingDelimiterIndex(value, 1, '[', ']');
  if (labelEnd < 0) return false;

  const destinationStart = labelEnd + 1;
  const destinationOpening = value[destinationStart];
  if (destinationOpening === '(') {
    return closingDelimiterIndex(value, destinationStart, '(', ')') === value.length - 1;
  }
  if (destinationOpening === '[') {
    return closingDelimiterIndex(value, destinationStart, '[', ']') === value.length - 1;
  }
  return false;
}

/**
 * Keeps Markdown block separators while removing blank constructs that Tiptap
 * materializes as editable paragraphs. Fenced code is intentionally byte-for-byte
 * unchanged apart from the document-wide newline normalization.
 */
export function normalizeMarkdownForWysiwyg(value: string) {
  const lines = trimDocumentEdgeEmptyParagraphs(value.replace(/\r\n?/gu, '\n').split('\n'));
  const normalized: string[] = [];
  let fence: MarkdownFence | null = null;
  let pendingBlankLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (fence) {
      normalized.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const nextFence = openingFence(line);
    if (nextFence) {
      if (pendingBlankLine && normalized.length) normalized.push('');
      pendingBlankLine = false;
      normalized.push(line);
      fence = nextFence;
      continue;
    }

    if (!line.trim()) {
      pendingBlankLine = true;
      continue;
    }

    if (emptyListItemPattern.test(line)) {
      if (!nextNonBlankLineIsListItem(lines, index + 1)) pendingBlankLine = true;
      continue;
    }

    if (isStandaloneMarkdownImage(line)) {
      if (normalized.length) {
        const previousIndex = normalized.length - 1;
        if (!pendingBlankLine) {
          normalized[previousIndex] = normalized[previousIndex]!.replace(markdownHardBreakPattern, '');
        }
        if (normalized[previousIndex] !== '') normalized.push('');
      }
      normalized.push(line.trim());
      pendingBlankLine = true;
      continue;
    }

    if (pendingBlankLine && normalized.length) normalized.push('');
    pendingBlankLine = false;
    normalized.push(recoverEscapedStrongMarks(line));
  }

  return normalized.join('\n');
}
