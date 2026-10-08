import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  desktopNoteSchema,
  type DesktopNote,
  type DesktopNoteSave,
  type DesktopNoteDraft,
} from '@/shared/contracts/desktop-petals';
import type { TemporaryFilesSnapshot } from '@/shared/contracts/temporary-files';
import {
  temporaryBodySchema,
  temporaryManifestSchema,
  type TemporaryBody,
  type TemporaryManifest,
  type TemporaryAttachment,
} from '@/main/temporary-files/temporary-file-record';
import { petalError } from '@/shared/petal-errors';

const uuid = z.string().uuid();
const settingsSchema = z.object({ limitMiB: z.number().int().min(16).max(16384) });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function removeFile(file: string) {
  try {
    await unlink(file);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

/** Content is local to this installation. The small manifests are the only startup reads. */
export class TemporaryFilesStore {
  readonly root: string;
  private manifests = new Map<string, TemporaryManifest>();
  private payloads = new Map<string, string>();
  private leases = new Map<string, number>();
  private limitMiB = 512;
  private queue: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;
  isOpen: (id: string) => boolean = () => false;
  constructor(userDataRoot: string) {
    this.root = path.join(userDataRoot, 'temporary-files');
    this.ready = this.load();
  }
  private async load() {
    await mkdir(this.root, { recursive: true });
    try {
      this.limitMiB = settingsSchema.parse(
        JSON.parse(await readFile(path.join(this.root, 'settings.json'), 'utf8')),
      ).limitMiB;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const entries = await readdir(this.root);
    for (const file of entries) {
      if (!file.endsWith('.manifest.json')) continue;
      const id = file.slice(0, -14);
      if (!uuid.safeParse(id).success) continue;
      const manifest = temporaryManifestSchema.parse(JSON.parse(await readFile(path.join(this.root, file), 'utf8')));
      if (manifest.id !== id) throw new Error('TEMPORARY_FILE_ID_MISMATCH');
      this.manifests.set(id, manifest);
      for (const attachment of manifest.attachments) this.payloads.set(attachment.id, attachment.extension ?? '.bin');
    }
    const retained = new Set(
      [...this.manifests.values()].flatMap((item) => [
        path.basename(this.file(item.body, 'json')),
        ...item.attachments.map((attachment) => path.basename(this.file(attachment.id, 'bin'))),
      ]),
    );
    // Interrupted writes have no committed receipt. Reclaim only files from this store's UUID namespace.
    for (const file of entries) {
      if (file.endsWith('.manifest.json') || retained.has(file)) continue;
      if (/^[a-f0-9-]{36}\.(?:json|bin|png|jpg|webp|gif|pending(?:\.png)?|[a-z0-9]{1,16})$/i.test(file))
        await removeFile(path.join(this.root, file));
    }
  }
  file(id: string, suffix: 'json' | 'bin' | 'manifest.json') {
    if (suffix === 'bin') return path.join(this.root, `${uuid.parse(id)}${this.payloads.get(id) ?? '.bin'}`);
    return path.join(this.root, `${uuid.parse(id)}.${suffix}`);
  }
  async atomic(destination: string, value: unknown) {
    const staging = path.join(this.root, `${randomUUID()}.pending`);
    await writeFile(staging, JSON.stringify(value), { flag: 'wx', flush: true });
    try {
      await rename(staging, destination);
    } finally {
      await removeFile(staging);
    }
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        return operation();
      });
    this.queue = result;
    return result;
  }
  manifest(id: string) {
    const result = this.manifests.get(uuid.parse(id));
    if (!result) throw petalError('sourceUnavailable');
    return result;
  }
  has(id: string) {
    return this.manifests.has(id);
  }
  retain(id: string) {
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    return () => {
      const count = (this.leases.get(id) ?? 1) - 1;
      if (count) this.leases.set(id, count);
      else this.leases.delete(id);
    };
  }
  async body(id: string): Promise<TemporaryBody> {
    await this.ready;
    return temporaryBodySchema.parse(JSON.parse(await readFile(this.file(this.manifest(id).body, 'json'), 'utf8')));
  }
  snapshot(): TemporaryFilesSnapshot {
    const items = [...this.manifests.values()].map(
      ({ id, kind, title, updatedAt, byteSize, protected: protectedContent }) => ({
        id,
        kind,
        title,
        updatedAt,
        byteSize,
        protected: protectedContent,
      }),
    );
    return {
      limitBytes: this.limitMiB * 1024 * 1024,
      usedBytes: items.reduce((sum, item) => sum + item.byteSize, 0),
      items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }
  async commit(manifest: TemporaryManifest, body: TemporaryBody) {
    const previous = this.manifests.get(manifest.id);
    const bodyId = randomUUID();
    const serialized = JSON.stringify(temporaryBodySchema.parse(body));
    const next = temporaryManifestSchema.parse({
      ...manifest,
      body: bodyId,
      title: body.note.title || body.note.text.slice(0, 100),
      updatedAt: new Date().toISOString(),
      byteSize: Buffer.byteLength(serialized) + manifest.attachments.reduce((sum, file) => sum + file.byteSize, 0),
    });
    await writeFile(this.file(bodyId, 'json'), serialized, { flag: 'wx', flush: true });
    try {
      await this.atomic(this.file(next.id, 'manifest.json'), next);
    } catch (error) {
      await removeFile(this.file(bodyId, 'json'));
      throw error;
    }
    this.manifests.set(next.id, next);
    if (previous)
      await removeFile(this.file(previous.body, 'json')).catch((error) =>
        console.error('[temporary-files] old body cleanup failed', error),
      );
  }
  async updateManifest(manifest: TemporaryManifest) {
    await this.atomic(this.file(manifest.id, 'manifest.json'), temporaryManifestSchema.parse(manifest));
    this.manifests.set(manifest.id, manifest);
  }
  async create(id: string, text = '', title = '', format?: 'markdown', sourcePath?: string) {
    uuid.parse(id);
    if (this.has(id)) return (await this.body(id)).note;
    if (this.manifests.size >= 1000) throw petalError('temporaryCapacity');
    await this.makeRoom(Buffer.byteLength(text) * 2 + 8192);
    const note = desktopNoteSchema.parse({
      id,
      stashId: id,
      text,
      title,
      format,
      contentHash: hash({ text, title }),
      color: 'rose',
      icon: 'feather',
      editable: true,
      revisionId: null,
      temporary: true,
    });
    await this.commit(
      {
        id,
        version: 1,
        body: randomUUID(),
        kind: 'NOTE',
        title,
        protected: true,
        updatedAt: new Date().toISOString(),
        byteSize: 0,
        attachments: [],
        sourcePath,
      },
      { note, draft: null },
    );
    return note;
  }
  async save(input: DesktopNoteSave) {
    const manifest = this.manifest(input.id);
    if (manifest.promotion) throw petalError('saving');
    const body = await this.body(input.id);
    if (body.note.contentHash !== input.expectedContentHash) throw petalError('unsaved');
    const references = (input.referenceAssetIds ?? body.note.references.map((item) => item.assetId)).map((assetId) => {
      const asset = manifest.attachments.find((item) => item.id === assetId)?.asset;
      if (!asset) throw petalError('sourceUnavailable');
      return { assetId, mediaUrl: asset.mediaUrl };
    });
    const note: DesktopNote = {
      ...body.note,
      text: input.text,
      title: input.title ?? body.note.title,
      format: input.format,
      document: input.document,
      references,
      elements: input.elements ?? body.note.elements,
      contentHash: hash(input),
      displayTitle: input.title || input.text.slice(0, 100),
    };
    // Existing authored input is always preserved, even when it takes the budget over its limit.
    await this.commit({ ...manifest, protected: true }, { ...body, note, draft: null });
    return note;
  }
  async checkpoint(input: DesktopNoteDraft) {
    const manifest = this.manifest(input.id);
    if (manifest.promotion) throw petalError('saving');
    const body = await this.body(input.id);
    if (body.draft?.editorId === input.editorId && body.draft.sequence >= input.sequence) return;
    if (body.note.contentHash !== input.expectedContentHash) throw petalError('unsaved');
    const { id: _id, ...draft } = input;
    await this.commit({ ...manifest, protected: true }, { ...body, draft });
  }
  async attach(id: string, attachment: TemporaryAttachment, bytes: Uint8Array) {
    const manifest = this.manifest(id);
    if (manifest.promotion) throw petalError('saving');
    const previous = manifest.attachments.find((item) => item.id === attachment.id);
    if (previous) {
      if (previous.hash !== attachment.hash) throw petalError('invalidSettings');
      return previous;
    }
    if (
      manifest.attachments.length >= 300 ||
      (attachment.asset && manifest.attachments.filter((item) => item.asset).length >= 100) ||
      (attachment.file && manifest.attachments.filter((item) => item.file).length >= 100)
    )
      throw petalError('fileLimit');
    await this.makeRoom(bytes.byteLength + 8192);
    const extension =
      attachment.file?.extension ??
      (
        { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' } as Record<
          string,
          string
        >
      )[attachment.mimeType] ??
      '.bin';
    attachment = { ...attachment, extension };
    this.payloads.set(attachment.id, extension);
    await writeFile(this.file(attachment.id, 'bin'), bytes, { flag: 'wx', flush: true });
    try {
      await this.commit({ ...manifest, attachments: [...manifest.attachments, attachment] }, await this.body(id));
    } catch (error) {
      await removeFile(this.file(attachment.id, 'bin'));
      throw error;
    }
    return attachment;
  }
  async discard(id: string) {
    const manifest = this.manifest(id);
    if (manifest.promotion) throw petalError('saving');
    await this.remove(manifest);
  }
  async pruneAttachments(id: string, keep: (attachment: TemporaryAttachment) => boolean) {
    const manifest = this.manifest(id);
    const removed = manifest.attachments.filter((file) => !keep(file));
    if (!removed.length) return;
    await this.commit({ ...manifest, attachments: manifest.attachments.filter(keep) }, await this.body(id));
    for (const file of removed) {
      await removeFile(this.file(file.id, 'bin')).catch((error) =>
        console.error('[temporary-files] obsolete image cleanup deferred until startup', error),
      );
      this.payloads.delete(file.id);
    }
  }
  async remove(manifest: TemporaryManifest) {
    // Removing the manifest is the commit point. Unreferenced payloads are never shown as recoverable files.
    await removeFile(this.file(manifest.id, 'manifest.json'));
    this.manifests.delete(manifest.id);
    for (const file of [
      ...manifest.attachments.map((item) => this.file(item.id, 'bin')),
      this.file(manifest.body, 'json'),
    ])
      await removeFile(file).catch((error) =>
        console.error('[temporary-files] payload cleanup deferred until startup', error),
      );
  }
  async makeRoom(required: number, cleanup = false) {
    const candidates = [...this.manifests.values()]
      .filter((item) => !item.protected && !item.promotion && !this.isOpen(item.id) && !this.leases.has(item.id))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const available = candidates.reduce((total, item) => total + item.byteSize, 0);
    if (!cleanup && this.snapshot().usedBytes + required - available > this.snapshot().limitBytes)
      throw petalError('temporaryCapacity');
    for (const item of candidates) {
      if (!cleanup && this.snapshot().usedBytes + required <= this.snapshot().limitBytes) break;
      await this.remove(item);
    }
    if (!cleanup && this.snapshot().usedBytes + required > this.snapshot().limitBytes)
      throw petalError('temporaryCapacity');
  }
  async configure(limitMiB: number) {
    const settings = settingsSchema.parse({ limitMiB });
    await this.atomic(path.join(this.root, 'settings.json'), settings);
    this.limitMiB = settings.limitMiB;
  }
  async media(owner: string, id: string) {
    await this.ready;
    const attachment = this.manifest(owner).attachments.find((item) => item.id === id);
    if (!attachment) throw petalError('sourceUnavailable');
    return { path: this.file(id, 'bin'), mimeType: attachment.mimeType };
  }
}

const stores = new Map<string, TemporaryFilesStore>();
export function temporaryFilesStore(root: string) {
  let store = stores.get(root);
  if (!store) {
    store = new TemporaryFilesStore(root);
    stores.set(root, store);
  }
  return store;
}
