import {
  allocateReadableDirectory,
  readableAlbumDirectory,
  readablePath,
} from '@/main/database/assets/readable-content-paths';
import {
  ReadableContentQueue,
  readableSourceTables as sourceTables,
} from '@/main/database/assets/readable-content-queue';
import type { RecordedLibraryChange } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { contentAssetPath } from '@/shared/content-document';
import { replaceMarkdownMedia } from '@/shared/content-markdown';
import { ContentReadError } from '@/shared/content-read-error';
import type { AssetFileRevealTargetDto } from '@/shared/contracts';
import type { ContentSource } from '@/shared/contracts/content-library';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, rmdir, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';

type Repositories = Pick<LibraryDatabaseRepositories, 'storage' | 'assetFiles'>;
type OwnedFile = { path: string; hash: string; fingerprint?: string; assetId?: string; mode: 'COPY' | 'GENERATED' };
type Row = { relative_directory: string; revision_id: string; files_json: string; album_id: string | null };
const fileNames = {
  ARTICLE: '文章.md',
  SOCIAL_POST: '贴图.md',
  INSPIRATION_STASH: '便签.md',
  VIDEO_DOCUMENT: '文稿.md',
} as const;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

class ReadableContentChangedError extends Error {
  constructor() {
    super('Document changed while preparing its folder; retry');
  }
}

async function fileHash(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Readable file was replaced');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function fileFingerprint(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Readable file was replaced');
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.birthtimeMs].join(':');
}
async function matches(file: string, hash: string, fingerprint?: string) {
  try {
    if (fingerprint && (await fileFingerprint(file)) === fingerprint) return true;
    return (await fileHash(file)) === hash;
  } catch {
    return false;
  }
}

/** Durable, bounded projection of saved documents into the existing album tree. */
export class ReadableContentRepository {
  private running: Promise<unknown> = Promise.resolve();
  private background: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly queue: ReadableContentQueue;
  constructor(
    private readonly repositories: Repositories,
    private readonly content: ContentLibraryRepository,
  ) {
    this.queue = new ReadableContentQueue(repositories.storage.db);
  }
  private get db() {
    return this.repositories.storage.db;
  }
  private get root() {
    return this.repositories.storage.libraryRoot;
  }
  private key(source: ContentSource) {
    return `${source.kind}:${source.id}`;
  }
  start() {
    this.queue.resume();
    this.stopped = false;
    this.schedule();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  async drain() {
    this.stop();
    await this.background;
    await this.running;
  }
  changed(changes: readonly RecordedLibraryChange[]) {
    this.queue.changed(changes);
    this.schedule();
  }
  private schedule() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.background = this.batch().catch((error: unknown) => {
        console.error('[readable-content] queue failed', error);
      });
    }, 1000);
    this.timer.unref?.();
  }
  private async batch() {
    if (this.stopped) return;
    const job = this.queue.next();
    if (!job) {
      if (this.queue.hasWork()) this.schedule();
      return;
    }
    const source = { kind: job.source_kind, id: job.source_id };
    try {
      if (this.active(source)) await this.ensure(source);
      else {
        const operation = this.running.catch(() => undefined).then(() => this.retire(source));
        this.running = operation;
        await operation;
      }
      this.queue.complete(job);
    } catch (error) {
      if (error instanceof ReadableContentChangedError) {
        this.schedule();
        return;
      }
      if (error instanceof ContentReadError) this.queue.unavailable(job);
      else this.queue.failed(job);
      this.db.prepare("UPDATE readable_content_files SET state = 'ERROR' WHERE source_key = ?").run(this.key(source));
      console.error(
        '[readable-content] projection failed',
        {
          source,
          generation: job.generation,
          attempts: job.attempts,
          ...(error instanceof ContentReadError
            ? { code: error.code, requestedSource: error.source, currentRevisionId: error.currentRevisionId }
            : {}),
        },
        error,
      );
    }
    this.schedule();
  }
  ensure(source: ContentSource): Promise<string> {
    // Reveal always uses the saved current document, even when initiated from a historical citation.
    const latest: ContentSource = {
      kind: source.kind === 'INSPIRATION_STASH' ? 'ARTICLE' : source.kind,
      id: source.id,
    };
    const operation = this.running
      .catch(() => undefined)
      .then(async () => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await this.project(latest);
          } catch (error) {
            if (!(error instanceof ReadableContentChangedError)) throw error;
            if (attempt < 2 && this.active(latest)) continue;
            // A concurrent save supersedes this projection without consuming failure attempts.
            this.queue.enqueue(latest);
            this.schedule();
            throw error;
          }
        }
      });
    this.running = operation;
    return operation;
  }
  listAssetTargets(assetId: string): AssetFileRevealTargetDto[] {
    const rows = this.db
      .prepare(
        "SELECT f.source_kind, f.source_id, f.relative_directory FROM readable_content_assets a JOIN readable_content_files f ON f.source_key = a.source_key WHERE f.state = 'ACTIVE' AND a.asset_id = ?",
      )
      .all(assetId) as { source_kind: ContentSource['kind']; source_id: string; relative_directory: string }[];
    return rows.map((row) => ({
      context: { kind: 'CONTENT', source: { kind: row.source_kind, id: row.source_id } },
      label: path.basename(row.relative_directory),
      relativeDirectory: row.relative_directory.split(path.sep).join('/'),
    }));
  }
  async assetPath(assetId: string, source: ContentSource) {
    const directory = await this.ensure(source);
    const row = this.db
      .prepare('SELECT files_json FROM readable_content_files WHERE relative_directory = ?')
      .get(path.relative(this.root, directory)) as { files_json: string } | undefined;
    const file = (row ? (JSON.parse(row.files_json) as OwnedFile[]) : []).find((file) => file.assetId === assetId);
    if (!file) throw new Error('Asset is not part of this content');
    await readablePath(this.root, path.dirname(file.path));
    if (!(await matches(path.join(this.root, file.path), file.hash, file.fingerprint)))
      throw new Error('Readable asset was modified');
    return path.join(this.root, file.path);
  }
  private albumId(source: ContentSource) {
    if (source.kind !== 'VIDEO_DOCUMENT')
      return (
        (
          this.db
            .prepare(`SELECT album_id FROM ${sourceTables[source.kind]} WHERE id = ? AND deleted_at IS NULL`)
            .get(source.id) as { album_id: string | null } | undefined
        )?.album_id ?? null
      );
    return (
      (
        this.db
          .prepare(
            "SELECT m.album_id FROM creation_forms f JOIN creation_items i ON i.id = f.creation_item_id AND i.deleted_at IS NULL JOIN album_members m ON m.target_type = 'CREATION_ITEM' AND m.target_id = i.id AND m.deleted_at IS NULL WHERE f.entity_type = 'VIDEO_DOCUMENT' AND f.entity_id = ? AND f.deleted_at IS NULL LIMIT 1",
          )
          .get(source.id) as { album_id: string } | undefined
      )?.album_id ?? null
    );
  }
  private async project(source: ContentSource): Promise<string> {
    if (!this.active(source)) throw new Error('Content unavailable');
    const documents = this.content.readableDocuments(source);
    const version = digest(
      JSON.stringify(
        documents.map(({ name, document }) => [name, document.revisionId, document.title, document.contentHash]),
      ),
    );
    const document = documents[0]!.document,
      key = this.key(source),
      albumId = this.albumId(source);
    const parent = await readableAlbumDirectory(this.repositories.storage, albumId);
    const previous = this.db.prepare('SELECT * FROM readable_content_files WHERE source_key = ?').get(key) as
      Row | undefined;
    const oldFiles = previous ? (JSON.parse(previous.files_json) as OwnedFile[]) : [];
    let relativeDirectory = previous?.relative_directory;
    if (relativeDirectory && path.dirname(relativeDirectory) === parent) {
      try {
        await readablePath(this.root, relativeDirectory);
      } catch {
        relativeDirectory = undefined;
      }
    } else relativeDirectory = undefined;
    relativeDirectory ??= await allocateReadableDirectory(
      this.root,
      parent,
      document.displayTitle || path.parse(fileNames[source.kind]).name,
    );
    const directory = await readablePath(this.root, relativeDirectory);
    const parts = documents.map(({ name, document }) => {
      const expanded = this.content.render(document.markdown);
      const media = [...document.media, ...expanded.media];
      return {
        name,
        title: document.title,
        media,
        markdown: replaceMarkdownMedia(
          expanded.markdown,
          new Map(media.map((asset) => [asset.path, contentAssetPath(asset.assetId)])),
        ),
      };
    });
    const media = [...new Map(parts.flatMap((part) => part.media).map((asset) => [asset.assetId, asset])).values()];
    const ids = media.map((asset) => asset.assetId);
    if (source.kind === 'VIDEO_DOCUMENT') {
      const video = this.db
        .prepare(
          "SELECT m.image_asset_id id FROM document_source_relations r JOIN materials m ON m.id = r.material_id WHERE r.document_id = ? AND r.role = 'PRIMARY_VIDEO' AND m.deleted_at IS NULL",
        )
        .get(source.id) as { id: string } | undefined;
      if (video && !ids.includes(video.id)) ids.push(video.id);
    }
    const assets = await this.repositories.assetFiles.resolveManyAsync(ids);
    if (assets.size !== new Set(ids).size) throw new Error('Document attachment unavailable');
    const files: OwnedFile[] = [],
      replacements = new Map<string, string>();
    const record = () =>
      this.db
        .prepare(
          `INSERT INTO readable_content_files(source_key, source_kind, source_id, album_id, relative_directory, revision_id, files_json, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?) ON CONFLICT(source_key) DO UPDATE SET album_id = excluded.album_id, relative_directory = excluded.relative_directory, revision_id = excluded.revision_id, files_json = excluded.files_json, state = 'PENDING', updated_at = excluded.updated_at`,
        )
        .run(
          key,
          source.kind,
          source.id,
          albumId,
          relativeDirectory,
          version,
          JSON.stringify([...files, ...oldFiles.filter((old) => !files.some((file) => file.path === old.path))]),
          now(),
        );
    for (const [index, id] of ids.entries()) {
      const asset = assets.get(id)!;
      const name = asset.mimeType.startsWith('video/')
        ? `原视频${asset.extension}`
        : `图片${index + 1}${asset.extension}`;
      const subdirectory = path.join(relativeDirectory, '附件');
      await readablePath(this.root, subdirectory, true);
      const file = await this.allocateFile(subdirectory, name, asset.objectHash, oldFiles);
      const owned: OwnedFile = {
        path: file,
        hash: asset.objectHash,
        assetId: id,
        mode: 'COPY',
        fingerprint: oldFiles.find((old) => old.path === file)?.fingerprint,
      };
      files.push(owned);
      record();
      if (!(await matches(path.join(this.root, file), asset.objectHash, owned.fingerprint))) {
        const disk = await statfs(directory);
        if (disk.bavail * disk.bsize < asset.byteSize + 100 * 1024 * 1024)
          throw new Error('Insufficient space for readable attachments');
        try {
          await copyFile(
            asset.absolutePath,
            path.join(this.root, file),
            constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL,
          );
        } catch (error) {
          if (!['ENOTSUP', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await copyFile(asset.absolutePath, path.join(this.root, file), constants.COPYFILE_EXCL);
        }
        if (!(await matches(path.join(this.root, file), asset.objectHash)))
          throw new Error('Readable attachment verification failed');
        await chmod(path.join(this.root, file), 0o444);
      }
      owned.fingerprint = await fileFingerprint(path.join(this.root, file));
      const relative = path.relative(relativeDirectory, file).split(path.sep).join('/');
      replacements.set(contentAssetPath(id), relative);
    }
    for (const part of parts) {
      const markdown =
        (part.title.trim() ? '# ' + part.title.trim() + '\n\n' : '') +
        replaceMarkdownMedia(part.markdown, replacements) +
        '\n';
      const textHash = digest(markdown);
      const textFile = await this.allocateFile(relativeDirectory, part.name, textHash, oldFiles);
      files.push({ path: textFile, hash: textHash, mode: 'GENERATED' });
      record();
      if (!(await matches(path.join(this.root, textFile), textHash))) {
        const target = path.join(this.root, textFile),
          temporary = path.join(directory, '.aiy-' + ulid() + '.tmp');
        await writeFile(temporary, markdown, { flag: 'wx' });
        try {
          await copyFile(temporary, target, constants.COPYFILE_EXCL);
          await chmod(target, 0o444);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      }
    }
    await this.removeOwnedFiles(oldFiles, files);
    if (previous && previous.relative_directory !== relativeDirectory) {
      await this.removeEmptyDirectory(previous.relative_directory);
    }
    if (!this.active(source)) throw new ReadableContentChangedError();
    const latestVersion = digest(
      JSON.stringify(
        this.content
          .readableDocuments(source)
          .map(({ name, document }) => [name, document.revisionId, document.title, document.contentHash]),
      ),
    );
    if (latestVersion !== version || this.albumId(source) !== albumId) throw new ReadableContentChangedError();
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE readable_content_files SET files_json = ?, state = 'ACTIVE', updated_at = ? WHERE source_key = ?",
        )
        .run(JSON.stringify(files), now(), key);
      this.db.prepare('DELETE FROM readable_content_assets WHERE source_key = ?').run(key);
      const insert = this.db.prepare(
        'INSERT INTO readable_content_assets(source_key, asset_id, relative_path) VALUES (?, ?, ?)',
      );
      for (const file of files) if (file.assetId) insert.run(key, file.assetId, file.path);
    })();
    return directory;
  }
  private active(source: ContentSource) {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM ' + sourceTables[source.kind] + " WHERE id = ? AND deleted_at IS NULL AND status = 'ACTIVE'",
        )
        .get(source.id),
    );
  }
  private async retire(source: ContentSource) {
    const key = this.key(source);
    const previous = this.db.prepare('SELECT * FROM readable_content_files WHERE source_key = ?').get(key) as
      Row | undefined;
    if (!previous) return;
    await this.removeOwnedFiles(JSON.parse(previous.files_json) as OwnedFile[]);
    await this.removeEmptyDirectory(previous.relative_directory);
    this.db
      .prepare(
        "UPDATE readable_content_files SET state = 'RETIRED', files_json = '[]', updated_at = ? WHERE source_key = ?",
      )
      .run(now(), key);
    this.db.prepare('DELETE FROM readable_content_assets WHERE source_key = ?').run(key);
  }
  private async removeOwnedFiles(oldFiles: readonly OwnedFile[], retained: readonly OwnedFile[] = []) {
    for (const old of oldFiles) {
      if (retained.some((file) => file.path === old.path)) continue;
      try {
        await readablePath(this.root, path.dirname(old.path));
        const absolute = path.join(this.root, old.path);
        if (await matches(absolute, old.hash)) {
          await chmod(absolute, 0o644);
          await unlink(absolute);
        }
      } catch {
        /* Unknown or edited files remain untouched. */
      }
    }
  }
  private async removeEmptyDirectory(relative: string) {
    try {
      const directory = await readablePath(this.root, relative);
      try {
        await rmdir(await readablePath(this.root, path.join(relative, '附件')));
      } catch {
        /* Keep nonempty or replaced paths. */
      }
      await rmdir(directory);
    } catch {
      /* Keep nonempty or replaced paths. */
    }
  }
  private async allocateFile(directory: string, name: string, hash: string, oldFiles: OwnedFile[]) {
    const stem = path.parse(name).name,
      extension = path.extname(name);
    for (let index = 1; index <= 10000; index++) {
      const candidate = path.join(directory, `${stem}${index === 1 ? '' : ` (${index})`}${extension}`),
        absolute = path.join(this.root, candidate);
      const old = oldFiles.find((file) => file.path === candidate);
      if (old?.hash === hash && (await matches(absolute, hash, old.fingerprint))) return candidate;
      try {
        await lstat(absolute);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
        throw error;
      }
    }
    throw new Error('No available readable filename');
  }
}
