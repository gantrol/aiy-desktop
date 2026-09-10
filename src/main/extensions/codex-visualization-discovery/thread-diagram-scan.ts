import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CodexVisualizationDateRange } from '@/shared/contracts/codex-visualizations';
import type {
  CodexVisualizationScanResult,
  CodexVisualizationSessionRecord,
  CodexVisualizationThreadArtifactRecord,
} from '@/main/extensions/codex-visualization-discovery/scan';
import { extractMessageDiagrams } from '@/main/extensions/codex-visualization-discovery/thread-diagram-extraction';
import { scanIndexedCodexThreadDiagrams } from '@/main/extensions/codex-visualization-discovery/thread-history-diagram-scan';

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_DAY_PATTERN = /^\d{2}$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SESSION_FILE_ID_PATTERN = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/i;
const SESSION_FILE_DATE_PATTERN = /(?:^|[^0-9])(\d{4}-\d{2}-\d{2})T/;
const MAX_DISCOVERED_FILES_PER_ROOT = 240;
const MAX_SESSION_FILES = 80;
const MAX_SESSION_READ_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_READ_BYTES = 192 * 1024 * 1024;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES_PER_SESSION = 32;
const MAX_ARTIFACTS_PER_SESSION = 64;
const READ_CHUNK_BYTES = 1024 * 1024;
const DISCOVERY_CONCURRENCY = 8;
const SESSION_SCAN_CONCURRENCY = 4;
const SCAN_TIME_BUDGET_MS = 20_000;

const responseItemSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    type: z.literal('response_item'),
    payload: z
      .object({
        type: z.literal('message'),
        id: z.string().min(1).max(256).optional(),
        role: z.literal('assistant'),
        content: z.array(z.unknown()).max(128),
        phase: z.string().max(64).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const outputTextSchema = z
  .object({
    type: z.literal('output_text'),
    text: z.string().max(MAX_RECORD_BYTES),
  })
  .passthrough();

interface CandidateFile {
  filePath: string;
  sessionId: string;
  byteSize: number;
  modifiedAt: string;
  modifiedAtMs: number;
}

interface BudgetedCandidate extends CandidateFile {
  maximumReadBytes: number;
}

function pathContainsTrash(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function scanExpired(deadlineMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return Date.now() >= deadlineMs;
}

function sessionIdFromFileName(fileName: string) {
  return SESSION_FILE_ID_PATTERN.exec(fileName)?.[1]?.toLowerCase() ?? null;
}

function dateInRange(date: string, range: CodexVisualizationDateRange) {
  return date >= range.from && date <= range.to;
}

function localDate(epochMs: number) {
  const date = new Date(epochMs);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sessionDateFromFileName(fileName: string) {
  return SESSION_FILE_DATE_PATTERN.exec(fileName)?.[1] ?? null;
}

async function childDirectories(directoryPath: string, pattern: RegExp) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          pattern.test(entry.name) &&
          !entry.name.toLowerCase().includes('trash'),
      )
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

async function validatedDirectory(directoryPath: string) {
  if (pathContainsTrash(directoryPath)) return false;
  try {
    const metadata = await lstat(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function discoverActiveSessionFiles(
  sessionsRoot: string,
  range: CodexVisualizationDateRange,
  excludedSessionIds: ReadonlySet<string>,
  deadlineMs: number,
  signal?: AbortSignal,
) {
  const available = await validatedDirectory(sessionsRoot);
  if (!available) return { available: false, filePaths: [] as string[] };
  const filePaths: string[] = [];
  const years = await childDirectories(sessionsRoot, YEAR_PATTERN);
  for (const yearPath of years.sort((left, right) => right.localeCompare(left, 'en'))) {
    if (scanExpired(deadlineMs, signal)) break;
    const year = path.basename(yearPath);
    if (year < range.from.slice(0, 4) || year > range.to.slice(0, 4)) continue;
    const months = await childDirectories(yearPath, MONTH_DAY_PATTERN);
    for (const monthPath of months.sort((left, right) => right.localeCompare(left, 'en'))) {
      if (scanExpired(deadlineMs, signal)) break;
      const month = path.basename(monthPath);
      const monthKey = `${year}-${month}`;
      if (monthKey < range.from.slice(0, 7) || monthKey > range.to.slice(0, 7)) continue;
      const days = await childDirectories(monthPath, MONTH_DAY_PATTERN);
      for (const dayPath of days.sort((left, right) => right.localeCompare(left, 'en'))) {
        if (scanExpired(deadlineMs, signal)) break;
        const sessionDate = `${monthKey}-${path.basename(dayPath)}`;
        if (!dateInRange(sessionDate, range)) continue;
        let entries;
        try {
          entries = await readdir(dayPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
          const sessionId = sessionIdFromFileName(entry.name);
          if (
            entry.isFile() &&
            !entry.isSymbolicLink() &&
            !entry.name.toLowerCase().includes('trash') &&
            sessionId &&
            !excludedSessionIds.has(sessionId)
          ) {
            filePaths.push(path.join(dayPath, entry.name));
          }
          if (filePaths.length >= MAX_DISCOVERED_FILES_PER_ROOT) return { available, filePaths };
        }
      }
    }
  }
  return { available, filePaths };
}

async function discoverArchivedSessionFiles(
  archivedRoot: string,
  range: CodexVisualizationDateRange,
  excludedSessionIds: ReadonlySet<string>,
  deadlineMs: number,
  signal?: AbortSignal,
) {
  const available = await validatedDirectory(archivedRoot);
  if (!available) return { available: false, filePaths: [] as string[] };
  if (scanExpired(deadlineMs, signal)) return { available, filePaths: [] as string[] };
  try {
    const entries = await readdir(archivedRoot, { withFileTypes: true });
    const filePaths = entries
      .filter((entry) => {
        const sessionId = sessionIdFromFileName(entry.name);
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          entry.name.toLowerCase().includes('trash') ||
          !sessionId ||
          excludedSessionIds.has(sessionId)
        ) {
          return false;
        }
        const sessionDate = sessionDateFromFileName(entry.name);
        return !sessionDate || dateInRange(sessionDate, range);
      })
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(0, MAX_DISCOVERED_FILES_PER_ROOT)
      .map((entry) => path.join(archivedRoot, entry.name));
    return { available, filePaths };
  } catch {
    return { available, filePaths: [] as string[] };
  }
}

async function inspectCandidates(
  filePaths: readonly string[],
  range: CodexVisualizationDateRange,
  deadlineMs: number,
  signal?: AbortSignal,
) {
  const candidates: CandidateFile[] = [];
  for (let offset = 0; offset < filePaths.length; offset += DISCOVERY_CONCURRENCY) {
    if (scanExpired(deadlineMs, signal)) break;
    const inspected = await Promise.all(
      filePaths.slice(offset, offset + DISCOVERY_CONCURRENCY).map(async (filePath) => {
        try {
          const sessionId = sessionIdFromFileName(path.basename(filePath));
          if (!sessionId || !SESSION_ID_PATTERN.test(sessionId) || pathContainsTrash(filePath)) return null;
          const metadata = await lstat(filePath);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) return null;
          const sessionDate = sessionDateFromFileName(path.basename(filePath)) ?? localDate(metadata.mtimeMs);
          if (!dateInRange(sessionDate, range)) return null;
          return {
            filePath,
            sessionId,
            byteSize: metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
            modifiedAtMs: metadata.mtimeMs,
          } satisfies CandidateFile;
        } catch {
          return null;
        }
      }),
    );
    candidates.push(...inspected.filter((candidate): candidate is CandidateFile => candidate !== null));
  }
  return candidates;
}

function selectCandidates(candidates: readonly CandidateFile[]) {
  const selected: CandidateFile[] = [];
  const seenSessionIds = new Set<string>();
  for (const candidate of [...candidates].sort(
    (left, right) => right.modifiedAtMs - left.modifiedAtMs || right.filePath.localeCompare(left.filePath),
  )) {
    if (seenSessionIds.has(candidate.sessionId)) continue;
    seenSessionIds.add(candidate.sessionId);
    selected.push(candidate);
    if (selected.length >= MAX_SESSION_FILES) break;
  }
  return selected;
}

function allocateReadBudgets(candidates: readonly CandidateFile[]) {
  const budgeted: BudgetedCandidate[] = [];
  let remainingBytes = MAX_TOTAL_READ_BYTES;
  for (const candidate of candidates) {
    const maximumReadBytes = Math.min(candidate.byteSize, MAX_SESSION_READ_BYTES, remainingBytes);
    if (maximumReadBytes <= 0) break;
    budgeted.push({ ...candidate, maximumReadBytes });
    remainingBytes -= maximumReadBytes;
  }
  return budgeted;
}

async function readCandidateTail(candidate: BudgetedCandidate, deadlineMs: number, signal?: AbortSignal) {
  const handle = await open(candidate.filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0) return '';
    const byteCount = Math.min(candidate.maximumReadBytes, metadata.size);
    const start = metadata.size - byteCount;
    const buffer = Buffer.allocUnsafe(byteCount);
    let offset = 0;
    while (offset < byteCount) {
      if (scanExpired(deadlineMs, signal)) return '';
      const requested = Math.min(READ_CHUNK_BYTES, byteCount - offset);
      const { bytesRead } = await handle.read(buffer, offset, requested, start + offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    let retained = buffer.subarray(0, offset);
    if (start > 0) {
      const firstBoundary = retained.indexOf(0x0a);
      retained = firstBoundary < 0 ? Buffer.alloc(0) : retained.subarray(firstBoundary + 1);
    }
    return retained.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function scanCandidate(
  candidate: BudgetedCandidate,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<CodexVisualizationSessionRecord | null> {
  let source: string;
  try {
    source = await readCandidateTail(candidate, deadlineMs, signal);
  } catch (reason) {
    if (signal?.aborted) throw reason;
    return null;
  }
  if (!source) return null;
  const artifacts: CodexVisualizationThreadArtifactRecord[] = [];
  const seenMessageIds = new Set<string>();
  let inspectedMessages = 0;
  const lines = source.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (scanExpired(deadlineMs, signal)) break;
    const line = lines[index]!;
    if (!line || Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) continue;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    const parsed = responseItemSchema.safeParse(parsedJson);
    if (!parsed.success || (parsed.data.payload.phase && parsed.data.payload.phase !== 'final_answer')) continue;
    const messageKey = parsed.data.payload.id ?? `${parsed.data.timestamp}:${index}`;
    if (seenMessageIds.has(messageKey)) continue;
    seenMessageIds.add(messageKey);
    inspectedMessages += 1;
    const markdownParts: string[] = [];
    for (const content of parsed.data.payload.content) {
      const output = outputTextSchema.safeParse(content);
      if (output.success) markdownParts.push(output.data.text);
    }
    if (markdownParts.length) {
      artifacts.push(
        ...extractMessageDiagrams(
          candidate.sessionId,
          parsed.data.payload.id ?? messageKey,
          parsed.data.timestamp,
          markdownParts.join('\n'),
        ),
      );
    }
    if (inspectedMessages >= MAX_MESSAGES_PER_SESSION || artifacts.length >= MAX_ARTIFACTS_PER_SESSION) break;
  }
  if (!artifacts.length) return null;
  const retainedArtifacts = artifacts
    .sort(
      (left, right) =>
        right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath),
    )
    .slice(0, MAX_ARTIFACTS_PER_SESSION);
  return {
    sessionId: candidate.sessionId,
    directoryPath: null,
    modifiedAt: retainedArtifacts[0]?.modifiedAt ?? candidate.modifiedAt,
    artifacts: retainedArtifacts,
  };
}

async function scanRolloutThreadDiagrams(
  codexHome: string,
  range: CodexVisualizationDateRange,
  excludedSessionIds: ReadonlySet<string>,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<Pick<CodexVisualizationScanResult, 'available' | 'sessions'>> {
  signal?.throwIfAborted();
  const [active, archived] = await Promise.all([
    discoverActiveSessionFiles(path.join(codexHome, 'sessions'), range, excludedSessionIds, deadlineMs, signal),
    discoverArchivedSessionFiles(
      path.join(codexHome, 'archived_sessions'),
      range,
      excludedSessionIds,
      deadlineMs,
      signal,
    ),
  ]);
  const available = active.available || archived.available;
  if (!available || scanExpired(deadlineMs, signal)) return { available, sessions: [] };
  const candidates = await inspectCandidates([...active.filePaths, ...archived.filePaths], range, deadlineMs, signal);
  const budgeted = allocateReadBudgets(selectCandidates(candidates));
  const sessions: CodexVisualizationSessionRecord[] = [];
  for (let offset = 0; offset < budgeted.length; offset += SESSION_SCAN_CONCURRENCY) {
    if (scanExpired(deadlineMs, signal)) break;
    const batch = await Promise.all(
      budgeted
        .slice(offset, offset + SESSION_SCAN_CONCURRENCY)
        .map((candidate) => scanCandidate(candidate, deadlineMs, signal)),
    );
    sessions.push(...batch.filter((session): session is CodexVisualizationSessionRecord => session !== null));
  }
  sessions.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { available, sessions };
}

function mergeThreadDiagramSessions(sessions: readonly CodexVisualizationSessionRecord[]) {
  const sessionsById = new Map<string, CodexVisualizationSessionRecord>();
  for (const session of sessions) {
    const existing = sessionsById.get(session.sessionId);
    if (!existing) {
      sessionsById.set(session.sessionId, session);
      continue;
    }
    const artifacts = [
      ...new Map([...existing.artifacts, ...session.artifacts].map((artifact) => [artifact.id, artifact])).values(),
    ]
      .sort(
        (left, right) =>
          right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath),
      )
      .slice(0, MAX_ARTIFACTS_PER_SESSION);
    sessionsById.set(session.sessionId, {
      sessionId: session.sessionId,
      directoryPath: null,
      modifiedAt: artifacts[0]?.modifiedAt ?? existing.modifiedAt,
      artifacts,
    });
  }
  return [...sessionsById.values()].sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function scanCodexThreadDiagrams(
  codexHome: string,
  range: CodexVisualizationDateRange,
  signal?: AbortSignal,
): Promise<CodexVisualizationScanResult> {
  const scannedAt = new Date().toISOString();
  if (pathContainsTrash(codexHome)) return { available: false, scannedAt, sessions: [] };
  const deadlineMs = Date.now() + SCAN_TIME_BUDGET_MS;
  signal?.throwIfAborted();
  const indexed = await scanIndexedCodexThreadDiagrams(codexHome, range, deadlineMs, signal);
  const coveredSessionIds = indexed.status === 'AVAILABLE' ? indexed.coveredSessionIds : new Set<string>();
  const rollout = await scanRolloutThreadDiagrams(codexHome, range, coveredSessionIds, deadlineMs, signal);
  const indexedSessions = indexed.status === 'AVAILABLE' ? indexed.sessions : [];
  return {
    available: indexed.status === 'AVAILABLE' || rollout.available,
    scannedAt,
    sessions: mergeThreadDiagramSessions([...indexedSessions, ...rollout.sessions]),
  };
}
