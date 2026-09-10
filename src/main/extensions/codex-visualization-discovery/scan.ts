import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  CodexVisualizationArtifactKind,
  CodexVisualizationArtifactRole,
} from '@/shared/contracts/codex-visualizations';

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_DAY_PATTERN = /^\d{2}$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_SESSION_DIRECTORIES = 10_000;
const MAX_SCAN_DEPTH = 2;
const MAX_SCANNED_ENTRIES_PER_SESSION = 512;
const MAX_ARTIFACTS_PER_SESSION = 256;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const SESSION_SCAN_CONCURRENCY = 12;

const artifactKindByExtension: Readonly<Record<string, CodexVisualizationArtifactKind | undefined>> = {
  '.html': 'INTERACTIVE',
  '.htm': 'INTERACTIVE',
  '.png': 'IMAGE',
  '.jpg': 'IMAGE',
  '.jpeg': 'IMAGE',
  '.webp': 'IMAGE',
  '.gif': 'IMAGE',
  '.avif': 'IMAGE',
  '.svg': 'VECTOR',
  '.pdf': 'DOCUMENT',
  '.mmd': 'DIAGRAM_SOURCE',
  '.mermaid': 'DIAGRAM_SOURCE',
  '.puml': 'DIAGRAM_SOURCE',
  '.plantuml': 'DIAGRAM_SOURCE',
  '.pu': 'DIAGRAM_SOURCE',
  '.uml': 'DIAGRAM_SOURCE',
  '.wsd': 'DIAGRAM_SOURCE',
  '.dot': 'DIAGRAM_SOURCE',
  '.gv': 'DIAGRAM_SOURCE',
  '.d2': 'DIAGRAM_SOURCE',
  '.dia': 'DIAGRAM_SOURCE',
  '.fig': 'DIAGRAM_SOURCE',
  '.gexf': 'DIAGRAM_SOURCE',
  '.graphml': 'DIAGRAM_SOURCE',
  '.drawio': 'DIAGRAM_SOURCE',
  '.excalidraw': 'DIAGRAM_SOURCE',
  '.bmpr': 'DIAGRAM_SOURCE',
  '.epgz': 'DIAGRAM_SOURCE',
  '.sketch': 'DIAGRAM_SOURCE',
  '.vsdx': 'DIAGRAM_SOURCE',
  '.wireframe': 'DIAGRAM_SOURCE',
  '.css': 'SUPPORT',
  '.js': 'SUPPORT',
  '.mjs': 'SUPPORT',
  '.cjs': 'SUPPORT',
  '.json': 'SUPPORT',
  '.csv': 'SUPPORT',
  '.md': 'SUPPORT',
  '.txt': 'SUPPORT',
  '.woff': 'SUPPORT',
  '.woff2': 'SUPPORT',
  '.ttf': 'SUPPORT',
  '.otf': 'SUPPORT',
  '.wasm': 'SUPPORT',
};

const skippedDirectoryNames = new Set([
  '.git',
  'blob_storage',
  'cache',
  'code cache',
  'crashpad',
  'dawngraphitecache',
  'gpucache',
  'indexeddb',
  'library',
  'local storage',
  'logs',
  'network',
  'node_modules',
  'objects',
  'service worker',
  'session storage',
  'shared dictionary',
  'trash',
]);

const supportingAssetDirectoryNames = new Set(['assets', 'fonts', 'resources', 'scripts', 'static', 'styles']);

interface CodexVisualizationArtifactRecordBase {
  id: string;
  sessionId: string;
  relativePath: string;
  fileName: string;
  extension: string;
  kind: CodexVisualizationArtifactKind;
  role: CodexVisualizationArtifactRole;
  byteSize: number;
  modifiedAt: string;
}

export interface CodexVisualizationFileArtifactRecord extends CodexVisualizationArtifactRecordBase {
  sourceKind: 'FILE';
  filePath: string;
}

export interface CodexVisualizationThreadArtifactRecord extends CodexVisualizationArtifactRecordBase {
  sourceKind: 'THREAD_MESSAGE';
  sourceText: string;
}

export type CodexVisualizationArtifactRecord =
  CodexVisualizationFileArtifactRecord | CodexVisualizationThreadArtifactRecord;

export interface CodexVisualizationSessionRecord {
  sessionId: string;
  directoryPath: string | null;
  modifiedAt: string;
  artifacts: CodexVisualizationArtifactRecord[];
}

export interface CodexVisualizationScanResult {
  available: boolean;
  scannedAt: string;
  sessions: CodexVisualizationSessionRecord[];
}

function shouldSkipDirectory(name: string) {
  const normalized = name.toLowerCase();
  return (
    name.startsWith('.') ||
    normalized.endsWith('-data') ||
    skippedDirectoryNames.has(normalized) ||
    normalized.includes('trash')
  );
}

function pathContainsTrash(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
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
          !shouldSkipDirectory(entry.name),
      )
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

async function discoverSessionDirectories(rootPath: string, signal?: AbortSignal) {
  const years = await childDirectories(rootPath, YEAR_PATTERN);
  const sessionDirectories: string[] = [];
  for (const yearPath of years.sort((left, right) => right.localeCompare(left, 'en'))) {
    signal?.throwIfAborted();
    const months = await childDirectories(yearPath, MONTH_DAY_PATTERN);
    for (const monthPath of months.sort((left, right) => right.localeCompare(left, 'en'))) {
      signal?.throwIfAborted();
      const days = await childDirectories(monthPath, MONTH_DAY_PATTERN);
      for (const dayPath of days.sort((left, right) => right.localeCompare(left, 'en'))) {
        signal?.throwIfAborted();
        const sessions = await childDirectories(dayPath, SESSION_ID_PATTERN);
        for (const sessionPath of sessions.sort((left, right) => right.localeCompare(left, 'en'))) {
          sessionDirectories.push(sessionPath);
          if (sessionDirectories.length >= MAX_SESSION_DIRECTORIES) return sessionDirectories;
        }
      }
    }
  }
  return sessionDirectories;
}

function artifactRole(kind: CodexVisualizationArtifactKind, relativeDirectory: string): CodexVisualizationArtifactRole {
  if (kind === 'SUPPORT') return 'SUPPORTING';
  const directorySegments = relativeDirectory.split('/').map((segment) => segment.toLowerCase());
  return directorySegments.some((segment) => supportingAssetDirectoryNames.has(segment)) ? 'SUPPORTING' : 'PRIMARY';
}

function artifactId(sessionId: string, relativePath: string) {
  return createHash('sha256').update(sessionId).update('\0').update(relativePath).digest('hex');
}

async function scanSessionDirectory(
  sessionPath: string,
  signal?: AbortSignal,
): Promise<CodexVisualizationSessionRecord | null> {
  const sessionId = path.basename(sessionPath);
  const pending: Array<{ directoryPath: string; relativeDirectory: string; depth: number }> = [
    { directoryPath: sessionPath, relativeDirectory: '', depth: 0 },
  ];
  const artifacts: CodexVisualizationArtifactRecord[] = [];
  let scannedEntryCount = 0;

  while (pending.length && scannedEntryCount < MAX_SCANNED_ENTRIES_PER_SESSION) {
    signal?.throwIfAborted();
    const current = pending.shift()!;
    let entries;
    try {
      const directoryStat = await lstat(current.directoryPath);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
      entries = await readdir(current.directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      signal?.throwIfAborted();
      scannedEntryCount += 1;
      if (scannedEntryCount > MAX_SCANNED_ENTRIES_PER_SESSION) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth < MAX_SCAN_DEPTH && !shouldSkipDirectory(entry.name)) {
          pending.push({
            directoryPath: path.join(current.directoryPath, entry.name),
            relativeDirectory: current.relativeDirectory ? `${current.relativeDirectory}/${entry.name}` : entry.name,
            depth: current.depth + 1,
          });
        }
        continue;
      }
      if (!entry.isFile() || entry.name.toLowerCase().includes('trash')) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const kind = artifactKindByExtension[extension];
      if (!kind) continue;
      const filePath = path.join(current.directoryPath, entry.name);
      let fileStat;
      try {
        fileStat = await lstat(filePath);
      } catch {
        continue;
      }
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_ARTIFACT_BYTES) continue;
      const relativePath = current.relativeDirectory ? `${current.relativeDirectory}/${entry.name}` : entry.name;
      if (relativePath.length > 1_024) continue;
      artifacts.push({
        id: artifactId(sessionId, relativePath),
        sessionId,
        relativePath,
        sourceKind: 'FILE',
        filePath,
        fileName: entry.name,
        extension,
        kind,
        role: artifactRole(kind, current.relativeDirectory),
        byteSize: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }
  }

  if (!artifacts.some((artifact) => artifact.role === 'PRIMARY')) return null;
  artifacts.sort((left, right) => {
    if (left.role !== right.role) return left.role === 'PRIMARY' ? -1 : 1;
    const modifiedOrder = right.modifiedAt.localeCompare(left.modifiedAt);
    return modifiedOrder || left.relativePath.localeCompare(right.relativePath);
  });
  const retainedArtifacts = artifacts.slice(0, MAX_ARTIFACTS_PER_SESSION);
  return {
    sessionId,
    directoryPath: sessionPath,
    modifiedAt: retainedArtifacts.reduce(
      (latest, artifact) => (artifact.modifiedAt > latest ? artifact.modifiedAt : latest),
      retainedArtifacts[0]!.modifiedAt,
    ),
    artifacts: retainedArtifacts,
  };
}

export async function scanCodexVisualizations(
  rootPath: string,
  signal?: AbortSignal,
): Promise<CodexVisualizationScanResult> {
  const scannedAt = new Date().toISOString();
  signal?.throwIfAborted();
  if (pathContainsTrash(rootPath)) return { available: false, scannedAt, sessions: [] };
  try {
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { available: false, scannedAt, sessions: [] };
    }
    await readdir(rootPath, { withFileTypes: true });
  } catch {
    return { available: false, scannedAt, sessions: [] };
  }

  const sessionDirectories = await discoverSessionDirectories(rootPath, signal);
  const sessions: CodexVisualizationSessionRecord[] = [];
  for (let offset = 0; offset < sessionDirectories.length; offset += SESSION_SCAN_CONCURRENCY) {
    signal?.throwIfAborted();
    const batch = await Promise.all(
      sessionDirectories
        .slice(offset, offset + SESSION_SCAN_CONCURRENCY)
        .map((sessionPath) => scanSessionDirectory(sessionPath, signal)),
    );
    sessions.push(...batch.filter((session): session is CodexVisualizationSessionRecord => session !== null));
  }
  sessions.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { available: true, scannedAt, sessions };
}
