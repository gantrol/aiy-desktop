import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstatSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationDateRange,
  CodexVisualizationHtmlPreviewDto,
  CodexVisualizationListInput,
  CodexVisualizationMermaidPreviewDto,
  CodexVisualizationSessionDto,
  CodexVisualizationSnapshotDto,
} from '@/shared/contracts/codex-visualizations';
import { CODEX_VISUALIZATION_PREVIEW_SCHEME } from '@/main/app/codex-visualization-preview-policy';
import { CodexThreadTitleIndex } from '@/main/extensions/codex-image-discovery/thread-title-index';
import {
  scanCodexVisualizations,
  type CodexVisualizationArtifactRecord,
  type CodexVisualizationScanResult,
  type CodexVisualizationSessionRecord,
} from '@/main/extensions/codex-visualization-discovery/scan';
import { scanCodexThreadDiagrams } from '@/main/extensions/codex-visualization-discovery/thread-diagram-scan';

const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;
const EXPORT_CONCURRENCY = 4;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
const HTML_PREVIEW_ID_PATTERN = /^[a-f0-9]{48}$/;
const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HTML_PREVIEW_TTL_MS = 5 * 60 * 1_000;
const MAX_ACTIVE_HTML_PREVIEWS = 3;
const MAX_HTML_PREVIEW_REQUESTS = 48;
const MAX_HTML_PREVIEW_BYTES = 24 * 1024 * 1024;
const MAX_MERMAID_PREVIEW_BYTES = 512 * 1024;
const MAX_SESSION_ARTIFACTS = 256;
const mermaidPreviewExtensions = new Set(['.mmd', '.mermaid']);

const htmlPreviewResourcePolicyByExtension: Readonly<
  Record<string, { contentType: string; maximumBytes: number } | undefined>
> = {
  '.html': { contentType: 'text/html; charset=utf-8', maximumBytes: 4 * 1024 * 1024 },
  '.htm': { contentType: 'text/html; charset=utf-8', maximumBytes: 4 * 1024 * 1024 },
  '.css': { contentType: 'text/css; charset=utf-8', maximumBytes: 2 * 1024 * 1024 },
  '.png': { contentType: 'image/png', maximumBytes: 8 * 1024 * 1024 },
  '.jpg': { contentType: 'image/jpeg', maximumBytes: 8 * 1024 * 1024 },
  '.jpeg': { contentType: 'image/jpeg', maximumBytes: 8 * 1024 * 1024 },
  '.webp': { contentType: 'image/webp', maximumBytes: 8 * 1024 * 1024 },
};

interface IndexedVisualizationSession extends CodexVisualizationSessionRecord {
  threadName: string;
  threadTitleAvailable: boolean;
}

interface CachedVisualizationScan {
  available: boolean;
  scannedAt: string;
  threadDiagramDateRange: CodexVisualizationDateRange | null;
  sessions: IndexedVisualizationSession[];
}

interface RunningVisualizationScan {
  dateRangeKey: string;
  controller: AbortController;
  promise: Promise<CachedVisualizationScan>;
}

interface HtmlPreviewAccess {
  previewId: string;
  artifactId: string;
  sessionDirectoryPath: string;
  entryRelativePath: string;
  expiresAtMs: number;
  requestCount: number;
  reservedBytes: number;
}

export interface CodexVisualizationHtmlPreviewResource {
  filePath: string;
  byteSize: number;
  contentType: string;
  entryDocument: boolean;
}

function isInsidePath(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathContainsTrash(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function encodedRelativeUrlPath(relativePath: string) {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

function htmlPreviewPathSegments(relativePath: string) {
  if (relativePath.length > 1_024) return null;
  const segments = relativePath.split('/').filter(Boolean);
  if (!segments.length || segments.length > 12) return null;
  const invalid = segments.some(
    (segment) =>
      segment === '.' ||
      segment === '..' ||
      segment.includes('\\') ||
      segment.includes('\0') ||
      segment.toLowerCase().includes('trash'),
  );
  return invalid ? null : segments;
}

function safeDirectoryStem(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || 'Codex visualization'
  );
}

function errorCode(reason: unknown) {
  return reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : '';
}

function dateRangeKey(range: CodexVisualizationDateRange | null) {
  return range ? `${range.from}:${range.to}` : '';
}

function sortArtifacts(artifacts: readonly CodexVisualizationArtifactRecord[]) {
  return [...artifacts]
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === 'PRIMARY' ? -1 : 1;
      return right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, MAX_SESSION_ARTIFACTS);
}

function mergeVisualizationSessions(
  fileScan: CodexVisualizationScanResult,
  threadScan: CodexVisualizationScanResult | null,
) {
  const sessions = new Map<string, CodexVisualizationSessionRecord>();
  for (const session of [...fileScan.sessions, ...(threadScan?.sessions ?? [])]) {
    const existing = sessions.get(session.sessionId);
    if (!existing) {
      sessions.set(session.sessionId, { ...session, artifacts: sortArtifacts(session.artifacts) });
      continue;
    }
    const artifactsById = new Map(
      [...existing.artifacts, ...session.artifacts].map((artifact) => [artifact.id, artifact] as const),
    );
    const artifacts = sortArtifacts([...artifactsById.values()]);
    sessions.set(session.sessionId, {
      sessionId: session.sessionId,
      directoryPath: existing.directoryPath ?? session.directoryPath,
      modifiedAt: artifacts.reduce(
        (latest, artifact) => (artifact.modifiedAt > latest ? artifact.modifiedAt : latest),
        existing.modifiedAt > session.modifiedAt ? existing.modifiedAt : session.modifiedAt,
      ),
      artifacts,
    });
  }
  return [...sessions.values()].sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

async function createUniqueDirectory(parentPath: string, requestedStem: string) {
  const parentStat = await lstat(parentPath);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Export destination is unavailable');
  const stem = safeDirectoryStem(requestedStem);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` ${attempt + 1}`;
    const candidate = path.join(parentPath, `${stem}${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (reason) {
      if (errorCode(reason) !== 'EEXIST') throw reason;
    }
  }
  throw new Error('Could not create a unique export folder');
}

async function copyVerifiedFile(sourcePath: string, destinationPath: string, destinationRoot?: string) {
  const before = await lstat(sourcePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Visualization source is unavailable');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const [resolvedDestinationRoot, resolvedDestinationParent] = await Promise.all([
    realpath(destinationRoot ?? path.dirname(destinationPath)),
    realpath(path.dirname(destinationPath)),
  ]);
  if (!isInsidePath(resolvedDestinationRoot, resolvedDestinationParent)) {
    throw new Error('Visualization export path escaped its destination folder');
  }
  try {
    const existingDestination = await lstat(destinationPath);
    if (!existingDestination.isFile() || existingDestination.isSymbolicLink()) {
      throw new Error('Visualization export destination is unavailable');
    }
  } catch (reason) {
    if (errorCode(reason) !== 'ENOENT') throw reason;
  }
  await copyFile(sourcePath, destinationPath);
  await chmod(destinationPath, 0o644).catch(() => undefined);
  const [after, destination] = await Promise.all([lstat(sourcePath), lstat(destinationPath)]);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    !destination.isFile() ||
    destination.isSymbolicLink() ||
    destination.size !== before.size
  ) {
    throw new Error('Visualization source changed while it was being exported');
  }
}

async function writeVerifiedText(sourceText: string, destinationPath: string, destinationRoot?: string) {
  const expectedBytes = Buffer.byteLength(sourceText, 'utf8');
  if (expectedBytes > MAX_EXPORT_BYTES) throw new Error('Visualization source is too large to export');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const [resolvedDestinationRoot, resolvedDestinationParent] = await Promise.all([
    realpath(destinationRoot ?? path.dirname(destinationPath)),
    realpath(path.dirname(destinationPath)),
  ]);
  if (!isInsidePath(resolvedDestinationRoot, resolvedDestinationParent)) {
    throw new Error('Visualization export path escaped its destination folder');
  }
  try {
    const existingDestination = await lstat(destinationPath);
    if (!existingDestination.isFile() || existingDestination.isSymbolicLink()) {
      throw new Error('Visualization export destination is unavailable');
    }
  } catch (reason) {
    if (errorCode(reason) !== 'ENOENT') throw reason;
  }
  await writeFile(destinationPath, sourceText, { encoding: 'utf8', mode: 0o644 });
  await chmod(destinationPath, 0o644).catch(() => undefined);
  const destination = await lstat(destinationPath);
  if (!destination.isFile() || destination.isSymbolicLink() || destination.size !== expectedBytes) {
    throw new Error('Visualization export could not be verified');
  }
}

function isSameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readVerifiedUtf8File(filePath: string, expectedBytes: number, expectedModifiedAt: string) {
  if (expectedBytes <= 0 || expectedBytes > MAX_MERMAID_PREVIEW_BYTES) {
    throw new Error('Mermaid preview exceeds the 512 KB safety limit');
  }
  const before = await lstat(filePath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== expectedBytes ||
    before.mtime.toISOString() !== expectedModifiedAt
  ) {
    throw new Error('Mermaid preview source changed before it could be read');
  }
  const handle = await open(filePath, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !isSameFile(before, opened) || opened.size !== expectedBytes) {
      throw new Error('Mermaid preview source changed before it could be read');
    }
    const bytes = await handle.readFile();
    const [afterRead, afterPath] = await Promise.all([handle.stat(), lstat(filePath)]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !isSameFile(opened, afterRead) ||
      !isSameFile(opened, afterPath) ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs ||
      bytes.byteLength !== expectedBytes
    ) {
      throw new Error('Mermaid preview source changed while it was being read');
    }
    const sourceText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!sourceText.trim() || sourceText.includes('\0')) throw new Error('Mermaid preview is not valid UTF-8');
    return sourceText;
  } finally {
    await handle.close();
  }
}

export class CodexVisualizationDiscovery extends EventEmitter {
  readonly codexHome: string;
  readonly rootPath: string;
  private readonly threadTitles: CodexThreadTitleIndex;
  private active = false;
  private disposed = false;
  private scanPromise: RunningVisualizationScan | null = null;
  private cachedScan: CachedVisualizationScan | null = null;
  private artifactById = new Map<string, CodexVisualizationArtifactRecord>();
  private sessionById = new Map<string, IndexedVisualizationSession>();
  private htmlPreviewById = new Map<string, HtmlPreviewAccess>();
  private rootWatcher: FSWatcher | null = null;
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOperationCount = 0;

  constructor(codexHome?: string) {
    super();
    const configuredHome = codexHome ?? process.env.CODEX_HOME?.trim();
    this.codexHome = path.resolve(configuredHome || path.join(os.homedir(), '.codex'));
    this.rootPath = path.join(this.codexHome, 'visualizations');
    this.threadTitles = new CodexThreadTitleIndex(this.codexHome);
  }

  status() {
    if (pathContainsTrash(this.codexHome)) {
      return { available: false, message: 'Codex visualization discovery refuses this source path' };
    }
    try {
      const codexHomeStat = lstatSync(this.codexHome);
      const codexHomeAvailable = codexHomeStat.isDirectory() && !codexHomeStat.isSymbolicLink();
      let rootAvailable = false;
      try {
        const rootStat = lstatSync(this.rootPath);
        rootAvailable = codexHomeAvailable && rootStat.isDirectory() && !rootStat.isSymbolicLink();
      } catch {
        rootAvailable = false;
      }
      return {
        available: codexHomeAvailable,
        message: rootAvailable
          ? `Codex visualizations are available at ${this.rootPath}`
          : `Waiting for Codex visualizations at ${this.rootPath}`,
      };
    } catch {
      return {
        available: false,
        message: `Codex home directory was not found at ${this.codexHome}`,
      };
    }
  }

  get hasPending() {
    return this.pendingOperationCount > 0 || this.scanPromise !== null;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active) {
      this.ensureWatcher();
      return;
    }
    this.scanPromise?.controller.abort();
    this.stopWatcher();
    this.cachedScan = null;
    this.artifactById.clear();
    this.sessionById.clear();
    this.htmlPreviewById.clear();
  }

  async list(input: CodexVisualizationListInput): Promise<CodexVisualizationSnapshotDto> {
    if (this.disposed) throw new Error('Codex visualization discovery is closed');
    this.setActive(true);
    const scan = await this.getScan(input.refresh === true, input.threadDiagramDateRange);
    const hiddenSessionIds = new Set(input.hiddenSessionIds);
    const favoriteSessionIds = new Set(input.favoriteSessionIds);
    const hiddenSessionCount = scan.sessions.filter((session) => hiddenSessionIds.has(session.sessionId)).length;
    const filtered = scan.sessions
      .filter((session) =>
        input.filter === 'HIDDEN' ? hiddenSessionIds.has(session.sessionId) : !hiddenSessionIds.has(session.sessionId),
      )
      .sort((left, right) => {
        const favoriteOrder =
          Number(favoriteSessionIds.has(right.sessionId)) - Number(favoriteSessionIds.has(left.sessionId));
        return favoriteOrder || right.modifiedAt.localeCompare(left.modifiedAt);
      });
    const pageCount = Math.ceil(filtered.length / input.pageSize);
    const page = pageCount === 0 ? 1 : Math.min(input.page, pageCount);
    const sessions = filtered.slice((page - 1) * input.pageSize, page * input.pageSize);
    const artifactCounts = scan.sessions.reduce(
      (counts, session) => {
        for (const artifact of session.artifacts) {
          counts.total += 1;
          if (artifact.sourceKind === 'THREAD_MESSAGE') counts.threadDiagrams += 1;
        }
        return counts;
      },
      { total: 0, threadDiagrams: 0 },
    );
    return {
      available: scan.available,
      rootPath: input.threadDiagramDateRange ? this.codexHome : this.rootPath,
      scannedAt: scan.scannedAt,
      threadDiagramDateRange: scan.threadDiagramDateRange,
      filter: input.filter,
      page,
      pageSize: input.pageSize,
      pageCount,
      totalSessionCount: scan.sessions.length,
      filteredSessionCount: filtered.length,
      hiddenSessionCount,
      totalArtifactCount: artifactCounts.total,
      threadDiagramArtifactCount: artifactCounts.threadDiagrams,
      sessions: sessions.map((session) => this.toSessionDto(session)),
    };
  }

  async resolveArtifactFile(artifactId: string) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
    const record = this.artifactById.get(artifactId);
    if (!record || record.sourceKind !== 'FILE') throw new Error('Codex visualization result is not a file');
    const rootStat = await lstat(this.rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('Codex visualization source folder is unavailable');
    }
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(this.rootPath), realpath(record.filePath)]);
    if (!isInsidePath(resolvedRoot, resolvedFile))
      throw new Error('Codex visualization result escaped its source folder');
    const fileStat = await lstat(record.filePath);
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.size > MAX_EXPORT_BYTES ||
      fileStat.size !== record.byteSize ||
      fileStat.mtime.toISOString() !== record.modifiedAt
    ) {
      throw new Error('Codex visualization result is unavailable');
    }
    return resolvedFile;
  }

  async prepareHtmlPreview(artifactId: string): Promise<CodexVisualizationHtmlPreviewDto> {
    if (this.disposed) throw new Error('Codex visualization discovery is closed');
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
    const artifact = this.artifactById.get(artifactId);
    if (!artifact || artifact.sourceKind !== 'FILE' || artifact.kind !== 'INTERACTIVE' || artifact.role !== 'PRIMARY') {
      throw new Error('This visualization does not support an HTML preview');
    }
    const resourcePolicy = htmlPreviewResourcePolicyByExtension[artifact.extension];
    if (!resourcePolicy || artifact.byteSize > resourcePolicy.maximumBytes) {
      throw new Error('HTML preview exceeds the 4 MB safety limit');
    }
    const session = this.sessionById.get(artifact.sessionId);
    if (!session?.directoryPath) throw new Error('Codex visualization session is unavailable');
    await this.resolveArtifactFile(artifactId);
    this.removeExpiredHtmlPreviews();
    while (this.htmlPreviewById.size >= MAX_ACTIVE_HTML_PREVIEWS) {
      const oldestPreviewId = this.htmlPreviewById.keys().next().value;
      if (typeof oldestPreviewId !== 'string') break;
      this.htmlPreviewById.delete(oldestPreviewId);
    }
    const previewId = randomBytes(24).toString('hex');
    const expiresAtMs = Date.now() + HTML_PREVIEW_TTL_MS;
    this.htmlPreviewById.set(previewId, {
      previewId,
      artifactId,
      sessionDirectoryPath: session.directoryPath,
      entryRelativePath: artifact.relativePath,
      expiresAtMs,
      requestCount: 0,
      reservedBytes: 0,
    });
    return {
      previewId,
      artifactId,
      url: `${CODEX_VISUALIZATION_PREVIEW_SCHEME}://${previewId}/${encodedRelativeUrlPath(artifact.relativePath)}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async prepareMermaidPreview(artifactId: string): Promise<CodexVisualizationMermaidPreviewDto> {
    if (this.disposed) throw new Error('Codex visualization discovery is closed');
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
    const artifact = this.artifactById.get(artifactId);
    if (
      !artifact ||
      artifact.kind !== 'DIAGRAM_SOURCE' ||
      artifact.role !== 'PRIMARY' ||
      !mermaidPreviewExtensions.has(artifact.extension)
    ) {
      throw new Error('This visualization does not support a Mermaid preview');
    }
    if (artifact.byteSize <= 0 || artifact.byteSize > MAX_MERMAID_PREVIEW_BYTES) {
      throw new Error('Mermaid preview exceeds the 512 KB safety limit');
    }
    const sourceText =
      artifact.sourceKind === 'THREAD_MESSAGE'
        ? artifact.sourceText
        : await readVerifiedUtf8File(
            await this.resolveArtifactFile(artifactId),
            artifact.byteSize,
            artifact.modifiedAt,
          );
    if (Buffer.byteLength(sourceText, 'utf8') !== artifact.byteSize || sourceText.includes('\0')) {
      throw new Error('Mermaid preview source changed; refresh the visualization list');
    }
    return { artifactId, sourceText };
  }

  releaseHtmlPreview(previewId: string) {
    if (!HTML_PREVIEW_ID_PATTERN.test(previewId)) throw new Error('Invalid HTML preview');
    this.htmlPreviewById.delete(previewId);
  }

  async resolveHtmlPreviewResource(
    previewId: string,
    relativePath: string,
    reserveBodyBytes: boolean,
  ): Promise<CodexVisualizationHtmlPreviewResource> {
    if (!HTML_PREVIEW_ID_PATTERN.test(previewId)) throw new Error('Invalid HTML preview');
    this.removeExpiredHtmlPreviews();
    const access = this.htmlPreviewById.get(previewId);
    if (!access) throw new Error('HTML preview expired');
    if (access.requestCount >= MAX_HTML_PREVIEW_REQUESTS) {
      this.htmlPreviewById.delete(previewId);
      throw new Error('HTML preview exceeded its request budget');
    }
    access.requestCount += 1;
    const segments = htmlPreviewPathSegments(relativePath);
    if (!segments) throw new Error('Invalid HTML preview resource');
    const normalizedRelativePath = segments.join('/');
    const extension = path.extname(segments.at(-1)!).toLowerCase();
    const resourcePolicy = htmlPreviewResourcePolicyByExtension[extension];
    const entryDocument = normalizedRelativePath === access.entryRelativePath;
    if (!resourcePolicy || ((extension === '.html' || extension === '.htm') && !entryDocument)) {
      throw new Error('HTML preview resource type is blocked');
    }
    const sessionStat = await lstat(access.sessionDirectoryPath);
    if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
      throw new Error('HTML preview source folder is unavailable');
    }
    let candidatePath = access.sessionDirectoryPath;
    for (let index = 0; index < segments.length; index += 1) {
      candidatePath = path.join(candidatePath, segments[index]!);
      const candidateStat = await lstat(candidatePath);
      const finalSegment = index === segments.length - 1;
      if (candidateStat.isSymbolicLink() || (finalSegment ? !candidateStat.isFile() : !candidateStat.isDirectory())) {
        throw new Error('HTML preview resource is unavailable');
      }
    }
    if (!isInsidePath(access.sessionDirectoryPath, candidatePath) || pathContainsTrash(candidatePath)) {
      throw new Error('HTML preview resource escaped its source folder');
    }
    const [resolvedRoot, resolvedSession, resolvedFile] = await Promise.all([
      realpath(this.rootPath),
      realpath(access.sessionDirectoryPath),
      realpath(candidatePath),
    ]);
    if (!isInsidePath(resolvedRoot, resolvedSession) || !isInsidePath(resolvedSession, resolvedFile)) {
      throw new Error('HTML preview resource escaped its source folder');
    }
    const fileStat = await lstat(candidatePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > resourcePolicy.maximumBytes) {
      throw new Error('HTML preview resource exceeds its safety limit');
    }
    if (entryDocument) {
      const artifact = this.artifactById.get(access.artifactId);
      if (!artifact || fileStat.size !== artifact.byteSize || fileStat.mtime.toISOString() !== artifact.modifiedAt) {
        throw new Error('HTML preview source changed; refresh the visualization list');
      }
    }
    const reservedBytes = reserveBodyBytes ? fileStat.size : 0;
    if (access.reservedBytes + reservedBytes > MAX_HTML_PREVIEW_BYTES) {
      this.htmlPreviewById.delete(previewId);
      throw new Error('HTML preview exceeded its loading budget');
    }
    access.reservedBytes += reservedBytes;
    return {
      filePath: resolvedFile,
      byteSize: fileStat.size,
      contentType: resourcePolicy.contentType,
      entryDocument,
    };
  }

  resolveMediaPath(artifactId: string) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) return null;
    const record = this.artifactById.get(artifactId);
    if (!record || record.sourceKind !== 'FILE' || record.kind !== 'IMAGE') return null;
    try {
      const rootStat = lstatSync(this.rootPath);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
      const sourceStat = lstatSync(record.filePath);
      if (
        !sourceStat.isFile() ||
        sourceStat.isSymbolicLink() ||
        sourceStat.size !== record.byteSize ||
        sourceStat.mtime.toISOString() !== record.modifiedAt
      )
        return null;
      const resolvedRoot = realpathSync(this.rootPath);
      const resolvedFile = realpathSync(record.filePath);
      return isInsidePath(resolvedRoot, resolvedFile) ? resolvedFile : null;
    } catch {
      return null;
    }
  }

  artifactExportName(artifactId: string) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
    const record = this.artifactById.get(artifactId);
    if (!record) throw new Error('Codex visualization result is unavailable');
    return path.basename(record.fileName);
  }

  artifactUsesThreadContent(artifactId: string) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
    const record = this.artifactById.get(artifactId);
    if (!record) throw new Error('Codex visualization result is unavailable');
    return record.sourceKind === 'THREAD_MESSAGE';
  }

  sessionExportName(sessionId: string) {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid Codex visualization session');
    const session = this.sessionById.get(sessionId);
    if (!session) throw new Error('Codex visualization session is unavailable');
    return `${safeDirectoryStem(session.threadName)} · ${sessionId.slice(0, 8)}`;
  }

  sessionUsesThreadContent(sessionId: string) {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid Codex visualization session');
    const session = this.sessionById.get(sessionId);
    if (!session) throw new Error('Codex visualization session is unavailable');
    return session.artifacts.some((artifact) => artifact.sourceKind === 'THREAD_MESSAGE');
  }

  async exportArtifact(artifactId: string, destinationPath: string) {
    this.pendingOperationCount += 1;
    try {
      if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Invalid Codex visualization result');
      const artifact = this.artifactById.get(artifactId);
      if (!artifact) throw new Error('Codex visualization result is unavailable');
      if (artifact.sourceKind === 'THREAD_MESSAGE') {
        await writeVerifiedText(artifact.sourceText, destinationPath);
        return;
      }
      const sourcePath = await this.resolveArtifactFile(artifactId);
      const sourceResolved = path.resolve(sourcePath);
      const destinationResolved = path.resolve(destinationPath);
      const sameDestination =
        process.platform === 'win32'
          ? sourceResolved.toLowerCase() === destinationResolved.toLowerCase()
          : sourceResolved === destinationResolved;
      if (sameDestination) throw new Error('Choose a different export destination');
      await copyVerifiedFile(sourcePath, destinationPath);
    } finally {
      this.pendingOperationCount -= 1;
    }
  }

  async exportSession(sessionId: string, destinationRoot: string) {
    this.pendingOperationCount += 1;
    try {
      if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Invalid Codex visualization session');
      const session = this.sessionById.get(sessionId);
      if (!session) throw new Error('Codex visualization session is unavailable');
      const totalBytes = session.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0);
      if (totalBytes > MAX_EXPORT_BYTES) throw new Error('Codex visualization export must be 1 GB or smaller');
      const destinationPath = await createUniqueDirectory(destinationRoot, this.sessionExportName(sessionId));
      const resolvedDestinationPath = await realpath(destinationPath);
      for (let offset = 0; offset < session.artifacts.length; offset += EXPORT_CONCURRENCY) {
        await Promise.all(
          session.artifacts.slice(offset, offset + EXPORT_CONCURRENCY).map(async (artifact) => {
            const relativeParts = artifact.relativePath.split('/').filter(Boolean);
            const targetPath = path.join(destinationPath, ...relativeParts);
            if (!isInsidePath(destinationPath, targetPath)) throw new Error('Invalid visualization export path');
            if (artifact.sourceKind === 'THREAD_MESSAGE') {
              await writeVerifiedText(artifact.sourceText, targetPath, resolvedDestinationPath);
            } else {
              const sourcePath = await this.resolveArtifactFile(artifact.id);
              await copyVerifiedFile(sourcePath, targetPath, resolvedDestinationPath);
            }
          }),
        );
      }
      return { destinationPath, exportedFileCount: session.artifacts.length };
    } finally {
      this.pendingOperationCount -= 1;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.scanPromise?.controller.abort();
    this.stopWatcher();
    const runningScan = this.scanPromise;
    if (runningScan) await runningScan.promise.catch(() => undefined);
    this.cachedScan = null;
    this.artifactById.clear();
    this.sessionById.clear();
    this.htmlPreviewById.clear();
    this.removeAllListeners();
  }

  private removeExpiredHtmlPreviews() {
    const now = Date.now();
    for (const [previewId, access] of this.htmlPreviewById) {
      if (access.expiresAtMs <= now) this.htmlPreviewById.delete(previewId);
    }
  }

  private async getScan(refresh: boolean, threadDiagramDateRange: CodexVisualizationDateRange | null) {
    const requestedDateRange = threadDiagramDateRange ? { ...threadDiagramDateRange } : null;
    const requestedDateRangeKey = dateRangeKey(requestedDateRange);
    if (!refresh && this.cachedScan && dateRangeKey(this.cachedScan.threadDiagramDateRange) === requestedDateRangeKey) {
      return this.cachedScan;
    }
    if (this.scanPromise) {
      if (!this.scanPromise.controller.signal.aborted && this.scanPromise.dateRangeKey === requestedDateRangeKey) {
        return this.scanPromise.promise;
      }
      this.scanPromise.controller.abort();
      await this.scanPromise.promise.catch(() => undefined);
    }
    const controller = new AbortController();
    const promise = this.performScan(requestedDateRange, controller.signal).finally(() => {
      if (this.scanPromise?.controller === controller) this.scanPromise = null;
    });
    const running = { dateRangeKey: requestedDateRangeKey, controller, promise };
    this.scanPromise = running;
    return promise;
  }

  private async performScan(
    threadDiagramDateRange: CodexVisualizationDateRange | null,
    signal: AbortSignal,
  ): Promise<CachedVisualizationScan> {
    const [fileScan, threadScan] = await Promise.all([
      scanCodexVisualizations(this.rootPath, signal),
      threadDiagramDateRange
        ? scanCodexThreadDiagrams(this.codexHome, threadDiagramDateRange, signal)
        : Promise.resolve(null),
    ]);
    signal.throwIfAborted();
    const mergedSessions = mergeVisualizationSessions(fileScan, threadScan);
    const titles = mergedSessions.length
      ? await this.threadTitles.resolve(mergedSessions.map((session) => session.sessionId))
      : new Map<string, string>();
    signal.throwIfAborted();
    const sessions = mergedSessions.map((session): IndexedVisualizationSession => {
      const threadName = titles.get(session.sessionId) ?? `Codex ${session.sessionId.slice(0, 8)}`;
      return {
        ...session,
        threadName,
        threadTitleAvailable: titles.has(session.sessionId),
      };
    });
    const scan = {
      available: fileScan.available || Boolean(threadScan?.available),
      scannedAt: new Date().toISOString(),
      threadDiagramDateRange,
      sessions,
    };
    if (!this.disposed && this.active) {
      this.cachedScan = scan;
      this.artifactById = new Map(
        sessions.flatMap((session) => session.artifacts.map((artifact) => [artifact.id, artifact] as const)),
      );
      this.sessionById = new Map(sessions.map((session) => [session.sessionId, session] as const));
      this.ensureWatcher();
    }
    return scan;
  }

  private toSessionDto(session: IndexedVisualizationSession): CodexVisualizationSessionDto {
    return {
      sessionId: session.sessionId,
      threadName: session.threadName,
      threadTitleAvailable: session.threadTitleAvailable,
      modifiedAt: session.modifiedAt,
      artifactCount: session.artifacts.length,
      primaryCount: session.artifacts.filter((artifact) => artifact.role === 'PRIMARY').length,
      artifacts: session.artifacts.map((artifact) => this.toArtifactDto(artifact)),
    };
  }

  private toArtifactDto(artifact: CodexVisualizationArtifactRecord): CodexVisualizationArtifactDto {
    return {
      id: artifact.id,
      sessionId: artifact.sessionId,
      relativePath: artifact.relativePath,
      fileName: artifact.fileName,
      extension: artifact.extension,
      sourceKind: artifact.sourceKind,
      kind: artifact.kind,
      role: artifact.role,
      byteSize: artifact.byteSize,
      modifiedAt: artifact.modifiedAt,
      mediaUrl:
        artifact.sourceKind === 'FILE' && artifact.kind === 'IMAGE'
          ? `aiy-media://codex-visualization/${encodeURIComponent(artifact.id)}?revision=${createHash('sha256')
              .update(`${artifact.byteSize}:${artifact.modifiedAt}`)
              .digest('hex')
              .slice(0, 12)}`
          : null,
    };
  }

  private ensureWatcher() {
    if (!this.active || this.disposed || this.rootWatcher) return;
    try {
      const rootStat = lstatSync(this.rootPath);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
      this.rootWatcher = watch(this.rootPath, { recursive: true, persistent: false }, (_event, fileName) => {
        const changedPath = fileName ?? '';
        if (changedPath.toLowerCase().includes('trash')) return;
        if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
        this.invalidationTimer = setTimeout(() => {
          this.invalidationTimer = null;
          this.cachedScan = null;
          this.emit('changed');
        }, 350);
      });
      this.rootWatcher.on('error', () => this.stopWatcher());
    } catch {
      this.rootWatcher = null;
    }
  }

  private stopWatcher() {
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
    this.invalidationTimer = null;
    this.rootWatcher?.close();
    this.rootWatcher = null;
  }
}
