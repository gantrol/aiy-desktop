import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,199}$/;
const SESSION_FILE_ID_PATTERN = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/i;
const SESSION_FILE_REFRESH_INTERVAL_MS = 5_000;
const MAX_TITLE_CODE_POINTS = 96;
const MAX_TITLE_SOURCE_CODE_UNITS = 8_192;

type JsonRecord = Record<string, unknown>;

interface SessionMetadata {
  parentThreadId: string | null;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function stripMarkdownLinks(value: string) {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const labelStart = value.indexOf('[', cursor);
    if (labelStart < 0) return result + value.slice(cursor);
    const labelEnd = value.indexOf(']', labelStart + 1);
    if (labelEnd < 0 || value[labelEnd + 1] !== '(') return result + value.slice(cursor);
    const targetEnd = value.indexOf(')', labelEnd + 2);
    if (targetEnd < 0) return result + value.slice(cursor);
    result += value.slice(cursor, labelStart);
    const label = value.slice(labelStart + 1, labelEnd);
    const target = value.slice(labelEnd + 2, targetEnd);
    result += label && target ? label : value.slice(labelStart, targetEnd + 1);
    cursor = targetEnd + 1;
  }
  return result;
}

function compactTitle(value: string, maxCodePoints = MAX_TITLE_CODE_POINTS) {
  const firstMeaningfulLine = value
    .slice(0, MAX_TITLE_SOURCE_CODE_UNITS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^<[^>]+>$/.test(line) && !/^[-=*]{3,}$/.test(line));
  if (!firstMeaningfulLine) return '';
  const normalized = stripMarkdownLinks(firstMeaningfulLine.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, ''))
    .replace(/\s+/g, ' ')
    .trim();
  const codePoints = [...normalized];
  return codePoints.length <= maxCodePoints ? normalized : `${codePoints.slice(0, maxCodePoints - 1).join('')}…`;
}

async function firstLine(filePath: string) {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    const first = await lines[Symbol.asyncIterator]().next();
    return first.done ? '' : first.value;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function indexSessionFiles(codexHome: string) {
  const files = new Map<string, string>();
  const roots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  for (const rootPath of roots) {
    const pending = [rootPath];
    while (pending.length) {
      const directoryPath = pending.pop()!;
      let entries;
      try {
        entries = await readdir(directoryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.name.toLowerCase().includes('trash')) continue;
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const match = entry.name.match(SESSION_FILE_ID_PATTERN);
        if (match?.[1] && !files.has(match[1])) files.set(match[1], entryPath);
      }
    }
  }
  return files;
}

/** Resolves visible Codex task names, including images produced by hidden subagent tasks. */
export class CodexThreadTitleIndex {
  private sessionFiles: Map<string, string> | null = null;
  private sessionFilesRefreshedAt = 0;
  private readonly metadata = new Map<string, SessionMetadata>();

  constructor(private readonly codexHome: string) {}

  async resolve(threadIds: readonly string[]) {
    const titles = await this.readVisibleTitles();
    const uniqueThreadIds = [...new Set(threadIds.filter((id) => THREAD_ID_PATTERN.test(id)))];
    const unresolvedIds = uniqueThreadIds.filter((id) => !titles.has(id));
    if (!unresolvedIds.length) return titles;

    const sessionFiles = await this.ensureSessionFiles(unresolvedIds);
    for (const threadId of unresolvedIds) {
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null = threadId;
      let inheritedTitle = '';
      while (cursor && !visited.has(cursor) && chain.length < 10) {
        visited.add(cursor);
        const visibleTitle = titles.get(cursor);
        if (visibleTitle) {
          inheritedTitle = visibleTitle;
          break;
        }
        chain.push(cursor);
        const metadata = await this.readSessionMetadata(cursor, sessionFiles.get(cursor));
        cursor = metadata?.parentThreadId ?? null;
      }
      if (inheritedTitle) {
        titles.set(threadId, inheritedTitle);
      }
    }
    return titles;
  }

  private async readVisibleTitles() {
    const entries = new Map<string, string>();
    try {
      const source = await readFile(path.join(this.codexHome, 'session_index.jsonl'), 'utf8');
      for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const value = record(JSON.parse(line));
          const id = typeof value?.id === 'string' ? value.id : '';
          const title = typeof value?.thread_name === 'string' ? compactTitle(value.thread_name, 180) : '';
          if (THREAD_ID_PATTERN.test(id) && title) entries.set(id, title);
        } catch {
          // A concurrent append can leave only the final line incomplete.
        }
      }
    } catch {
      // Generated images remain discoverable without the optional title index.
    }
    return entries;
  }

  private async ensureSessionFiles(unresolvedIds: readonly string[]) {
    const now = Date.now();
    const needsRefresh =
      !this.sessionFiles ||
      (unresolvedIds.some((id) => !this.sessionFiles!.has(id)) &&
        now - this.sessionFilesRefreshedAt >= SESSION_FILE_REFRESH_INTERVAL_MS);
    if (needsRefresh) {
      this.sessionFiles = await indexSessionFiles(this.codexHome);
      this.sessionFilesRefreshedAt = now;
    }
    return this.sessionFiles ?? new Map<string, string>();
  }

  private async readSessionMetadata(threadId: string, filePath: string | undefined) {
    if (this.metadata.has(threadId)) return this.metadata.get(threadId)!;
    if (!filePath) return null;
    try {
      const value = record(JSON.parse(await firstLine(filePath)));
      const payload = record(value?.payload);
      const source = record(payload?.source);
      const subagent = record(source?.subagent);
      const spawn = record(subagent?.thread_spawn);
      const parentThreadId =
        typeof spawn?.parent_thread_id === 'string' && THREAD_ID_PATTERN.test(spawn.parent_thread_id)
          ? spawn.parent_thread_id
          : null;
      const metadata = { parentThreadId };
      this.metadata.set(threadId, metadata);
      return metadata;
    } catch {
      return null;
    }
  }
}
