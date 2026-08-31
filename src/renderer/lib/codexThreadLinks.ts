import { defaultUrlTransform } from 'react-markdown';
import { codexThreadHref, parseCodexThreadHref, type CodexThreadId } from '@/shared/contracts/codex-thread';

const CODEX_THREAD_TEXT_PATTERN =
  /codex:\/\/threads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![a-f0-9-])/gi;

export type CodexThreadTextSegment =
  | { kind: 'TEXT'; offset: number; value: string }
  | { kind: 'THREAD'; offset: number; value: string; threadId: CodexThreadId };

export function codexMarkdownUrlTransform(value: string) {
  const threadId = parseCodexThreadHref(value);
  return threadId ? codexThreadHref(threadId) : defaultUrlTransform(value);
}

export function codexThreadTextSegments(value: string): CodexThreadTextSegment[] {
  const segments: CodexThreadTextSegment[] = [];
  let offset = 0;

  for (const match of value.matchAll(CODEX_THREAD_TEXT_PATTERN)) {
    const index = match.index;
    const candidate = match[0];
    const threadId = parseCodexThreadHref(candidate);
    if (!threadId) continue;
    if (index > offset) segments.push({ kind: 'TEXT', offset, value: value.slice(offset, index) });
    segments.push({ kind: 'THREAD', offset: index, value: candidate, threadId });
    offset = index + candidate.length;
  }

  if (offset < value.length) segments.push({ kind: 'TEXT', offset, value: value.slice(offset) });
  return segments.length ? segments : [{ kind: 'TEXT', offset: 0, value }];
}
