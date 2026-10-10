import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  CLIPBOARD_IMAGE_LIMIT,
  clipboardEntrySchema,
  clipboardSettingsSchema,
  type ClipboardEntry,
  type ClipboardSettings,
} from '@/shared/contracts/clipboard-capture';

const indexSchema = z
  .object({
    version: z.literal(1),
    settings: clipboardSettingsSchema,
    items: z.array(clipboardEntrySchema).max(1000),
    retired: z
      .array(z.object({ id: z.string().uuid(), bytes: z.number().int().nonnegative() }).strict())
      .max(1000)
      .default([]),
  })
  .strict();
const bodySchema = z.object({ text: z.string().max(262144), html: z.string().max(262144) }).strict();
export interface ClipboardPayload {
  text: string;
  html: string;
  image: Buffer | null;
  source: string;
  reference: boolean;
  dimensions?: { width: number; height: number };
}
const hash = (body: string, image: Buffer | null) =>
  createHash('sha256')
    .update(body)
    .update(image ?? Buffer.alloc(0))
    .digest('hex');

/** Originals are owned files. The index is committed before any evicted payload is removed. */
export class ClipboardStore {
  get limitBytes() {
    return this.settings.limitMiB * 1024 * 1024;
  }
  get limitCount() {
    return this.settings.limitCount;
  }
  private index: z.infer<typeof indexSchema> = {
    version: 1,
    settings: clipboardSettingsSchema.parse({
      recording: false,
      preserveImageFiles: false,
      excludedApps: [],
      captureShortcut: '',
    }),
    items: [],
    retired: [],
  };
  private pending: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;
  constructor(
    private readonly root: string,
    defaults: Partial<ClipboardSettings> = {},
  ) {
    this.index.settings = clipboardSettingsSchema.parse({ ...this.index.settings, ...defaults });
    this.ready = this.load();
    void this.ready.catch(() => undefined);
  }
  get settings() {
    return this.index.settings;
  }
  get items() {
    return this.index.items;
  }
  get usedBytes() {
    return [...this.items, ...this.index.retired].reduce((total, item) => total + item.bytes, 0);
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        return operation();
      });
    this.pending = task;
    return task;
  }
  drain() {
    return this.pending.catch(() => undefined);
  }
  private directory(id: string) {
    return path.join(this.root, z.string().uuid().parse(id));
  }
  private async bounded(file: string, maximum: number) {
    const handle = await open(file, 'r');
    try {
      const size = (await handle.stat()).size;
      if (size > maximum) throw new Error('corrupt');
      // Read at most the checked size even if another process changes the file.
      const bytes = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const result = await handle.read(bytes, offset, size - offset, offset);
        if (!result.bytesRead) throw new Error('corrupt');
        offset += result.bytesRead;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
  private async load() {
    try {
      this.index = indexSchema.parse(
        JSON.parse((await this.bounded(path.join(this.root, 'index.json'), 4 * 1024 * 1024)).toString('utf8')),
      );
      const all = [...this.items, ...this.index.retired];
      if (
        new Set(all.map((item) => item.id)).size !== all.length ||
        this.items.reduce((total, item) => total + item.bytes, 0) > 512 * 1024 * 1024
      )
        throw new Error('corrupt');
      await this.expire();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('storage');
      // Missing index with existing files is not a new history. Never adopt or delete orphaned files automatically.
      try {
        await stat(this.root);
        throw new Error('storage');
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
      }
    }
  }
  private async commit(next: z.infer<typeof indexSchema>) {
    await mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next), { flag: 'wx', flush: true });
      await rename(temporary, path.join(this.root, 'index.json'));
      this.index = next;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async configure(settings: ClipboardSettings) {
    await this.cleanup();
    const next = clipboardSettingsSchema.parse(settings);
    const oldest = next.retentionDays ? Date.now() - next.retentionDays * 86400000 : 0;
    const retained = this.items.filter((item) => item.pinned || Date.parse(item.createdAt) >= oldest);
    let bytes = retained.reduce((sum, item) => sum + item.bytes, 0);
    while (retained.length > next.limitCount || bytes > next.limitMiB * 1024 * 1024) {
      const index = retained.findLastIndex((item) => !item.pinned);
      if (index < 0) throw new Error('full');
      bytes -= retained.splice(index, 1)[0].bytes;
    }
    const ids = new Set(retained.map((item) => item.id));
    await this.commit({
      ...this.index,
      settings: next,
      items: retained,
      retired: this.items.filter((item) => !ids.has(item.id)).map(({ id, bytes }) => ({ id, bytes })),
    });
    await this.cleanup();
  }
  async expire() {
    if (!this.settings.retentionDays) return;
    const oldest = Date.now() - this.settings.retentionDays * 86400000;
    const expired = this.items.filter((item) => !item.pinned && Date.parse(item.createdAt) < oldest);
    if (expired.length) await this.removeMany(expired.map((item) => item.id));
  }
  entry(id: string) {
    const entry = this.items.find((item) => item.id === id);
    if (!entry) throw new Error('missing');
    return entry;
  }
  async read(id: string): Promise<ClipboardPayload> {
    const entry = this.entry(id);
    try {
      const bodyBytes = await this.bounded(path.join(this.directory(id), 'body.json'), 4 * 1024 * 1024);
      const body = bodySchema.parse(JSON.parse(bodyBytes.toString('utf8')));
      const image =
        entry.kind === 'image'
          ? await this.bounded(path.join(this.directory(id), 'original.png'), CLIPBOARD_IMAGE_LIMIT)
          : null;
      if (hash(bodyBytes.toString('utf8'), image) !== entry.hash) throw new Error('corrupt');
      return { ...body, image, source: entry.source, reference: entry.kind === 'reference' };
    } catch {
      throw new Error('corrupt');
    }
  }
  async add(payload: ClipboardPayload, mayCommit: () => boolean, unique = false, requestId?: string): Promise<string> {
    await this.expire();
    await this.cleanup();
    const body = JSON.stringify(bodySchema.parse({ text: payload.text, html: payload.html }));
    const bytes = Buffer.byteLength(body) + (payload.image?.length ?? 0);
    if ((payload.image?.length ?? 0) > CLIPBOARD_IMAGE_LIMIT) throw new Error('tooLarge');
    const digest = hash(body, payload.image);
    const id = requestId ? z.string().uuid().parse(requestId) : randomUUID();
    // Capture retries retain their identity even when post-commit cleanup failed.
    const previous = this.items.find((item) => item.id === id);
    if (previous) {
      if (previous.hash !== digest || previous.source !== payload.source) throw new Error('corrupt');
      await this.read(id);
      if (!mayCommit()) throw new Error('cancelled');
      return id;
    }
    const duplicate = unique
      ? undefined
      : this.items.find((item) => item.hash === digest && item.source === payload.source);
    if (
      duplicate &&
      (await this.read(duplicate.id).then(
        () => true,
        () => false,
      ))
    ) {
      if (!mayCommit()) throw new Error('cancelled');
      await this.commit({
        ...this.index,
        items: [
          { ...duplicate, createdAt: new Date().toISOString() },
          ...this.items.filter((item) => item.id !== duplicate.id),
        ],
      });
      return duplicate.id;
    }
    const retained = [...this.items];
    const removed: ClipboardEntry[] = [];
    let used = this.usedBytes;
    while (retained.length >= this.limitCount || used + bytes > this.limitBytes) {
      const index = retained.findLastIndex((item) => !item.pinned);
      if (index < 0) throw new Error('full');
      const [item] = retained.splice(index, 1);
      removed.push(item);
      used -= item.bytes;
    }
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true });
    let committed = false;
    try {
      await writeFile(path.join(directory, 'body.json'), body, { flag: 'wx', flush: true });
      if (payload.image)
        await writeFile(path.join(directory, 'original.png'), payload.image, { flag: 'wx', flush: true });
      if (!mayCommit()) throw new Error('cancelled');
      await this.commit({
        ...this.index,
        retired: removed.map(({ id, bytes }) => ({ id, bytes })),
        items: [
          {
            id,
            createdAt: new Date().toISOString(),
            kind: payload.image ? 'image' : payload.reference ? 'reference' : 'text',
            preview: payload.text.slice(0, 512),
            source: payload.source.slice(0, 80),
            pinned: false,
            bytes,
            hash: digest,
            ...payload.dimensions,
          },
          ...retained,
        ],
      });
      committed = true;
      await this.cleanup();
      return id;
    } finally {
      if (!committed) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async pin(id: string, pinned: boolean) {
    this.entry(id);
    await this.commit({
      ...this.index,
      items: this.items.map((item) => (item.id === id ? { ...item, pinned } : item)),
    });
  }
  async rename(id: string, title: string) {
    this.entry(id);
    await this.commit({ ...this.index, items: this.items.map((item) => (item.id === id ? { ...item, title } : item)) });
  }
  async remove(id: string) {
    await this.removeMany([id]);
  }
  async removeMany(ids: string[]) {
    await this.cleanup();
    const selected = new Set(ids);
    const retired = [...selected].map((id) => {
      const { bytes } = this.entry(id);
      return { id, bytes };
    });
    await this.commit({ ...this.index, retired, items: this.items.filter((item) => !selected.has(item.id)) });
    await this.cleanup();
  }
  private async cleanup() {
    if (!this.index.retired.length) return;
    // Only persisted deletion intents can remove files; absence from a rebuilt index is never proof of garbage.
    try {
      for (const item of this.index.retired) await rm(this.directory(item.id), { recursive: true, force: true });
      await this.commit({ ...this.index, retired: [] });
    } catch {
      throw new Error('cleanup');
    }
  }
  async list(query: string, filter: 'all' | 'image' | 'text' | 'pinned', offset: number, current: () => boolean) {
    const candidates = this.items.filter(
      (item) => filter === 'all' || (filter === 'pinned' ? item.pinned : item.kind === filter),
    );
    const needle = query.trim().toLocaleLowerCase();
    const items: ClipboardEntry[] = [];
    let cursor = offset;
    for (; cursor < candidates.length && items.length < 50; cursor++) {
      if (!current()) throw new Error('cancelled');
      const item = candidates[cursor];
      if (needle && !`${item.title ?? ''}\n${item.preview}\n${item.source}`.toLocaleLowerCase().includes(needle)) {
        // Search complete text on demand, one bounded body at a time; never read image bytes for search.
        try {
          const body = await this.bounded(path.join(this.directory(item.id), 'body.json'), 4 * 1024 * 1024);
          const parsed = bodySchema.safeParse(JSON.parse(body.toString('utf8')));
          if (!parsed.success || !parsed.data.text.toLocaleLowerCase().includes(needle)) continue;
        } catch {
          continue;
        }
      }
      items.push(item);
    }
    return { kind: 'list' as const, items, nextOffset: cursor < candidates.length ? cursor : null };
  }
}
