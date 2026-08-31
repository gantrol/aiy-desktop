import { z } from 'zod';

export const codexThreadIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);

export type CodexThreadId = z.infer<typeof codexThreadIdSchema>;

export function codexThreadHref(threadId: string) {
  return `codex://threads/${encodeURIComponent(codexThreadIdSchema.parse(threadId))}`;
}

export function parseCodexThreadHref(value: unknown): CodexThreadId | null {
  if (typeof value !== 'string' || value !== value.trim()) return null;

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }

  if (
    target.protocol !== 'codex:' ||
    target.host !== 'threads' ||
    target.username ||
    target.password ||
    target.port ||
    target.search ||
    target.hash ||
    !target.pathname.startsWith('/') ||
    target.pathname.slice(1).includes('/')
  ) {
    return null;
  }

  let threadId: string;
  try {
    threadId = decodeURIComponent(target.pathname.slice(1));
  } catch {
    return null;
  }

  const parsed = codexThreadIdSchema.safeParse(threadId);
  return parsed.success ? parsed.data : null;
}
