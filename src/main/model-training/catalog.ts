import Database from 'better-sqlite3';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { GalleryRepository } from '@/main/database/assets/gallery-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { TrainingDataset } from '@/shared/model-training';

/** Explicit developer CLI only. Read-only SQLite work never runs on Electron's main thread. */
export async function catalogImages(library: string, limit: number) {
  const root = await realpath(library);
  const db = new Database(path.join(root, 'library.sqlite3'), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const gallery = new GalleryRepository({ db } as LibraryStorage);
  const candidates: TrainingDataset['entries'] = [];
  const seen = new Set<string>();
  try {
    const version = db.pragma('data_version', { simple: true });
    let after = '';
    let scanned = 0;
    for (;;) {
      const sources = gallery.listImageSearchSources(after);
      if (!sources.length) break;
      scanned += sources.length;
      if (scanned > 20_000) throw new Error('CATALOG_LIMIT');
      const paths = new Map(
        (
          db
            .prepare('SELECT id,relative_path FROM image_assets WHERE id IN (SELECT value FROM json_each(?))')
            .all(JSON.stringify(sources.map((source) => source.id))) as { id: string; relative_path: string }[]
        ).map((row) => [row.id, row.relative_path]),
      );
      for (const source of sources) {
        if (
          !['image/png', 'image/jpeg', 'image/webp'].includes(source.mime) ||
          source.bytes > 32 * 1024 * 1024 ||
          seen.has(source.hash)
        )
          continue;
        const relative = paths.get(source.id);
        if (!relative || relative.toLowerCase().includes('trash') || path.isAbsolute(relative)) continue;
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) continue;
        candidates.push({
          id: source.id,
          revision: source.hash,
          sourceGroup: source.hash,
          title: source.title,
          path: file,
          mime: source.mime as TrainingDataset['entries'][number]['mime'],
        });
        seen.add(source.hash);
      }
      after = sources.at(-1)!.id;
    }
    if (version !== db.pragma('data_version', { simple: true })) throw new Error('LIBRARY_CHANGED');
  } finally {
    db.close();
  }
  // Stable spread over content hashes, rather than taking only the newest screenshots.
  candidates.sort((a, b) => a.revision.localeCompare(b.revision));
  const entries: TrainingDataset['entries'] = [];
  const step = Math.max(1, candidates.length / limit);
  for (let index = 0; entries.length < limit && Math.floor(index) < candidates.length; index += step) {
    const entry = candidates[Math.floor(index)];
    const resolved = await realpath(entry.path).catch(() => '');
    if (!resolved.startsWith(root + path.sep) || resolved.toLowerCase().includes('trash')) continue;
    const info = await stat(resolved);
    if (info.isFile()) entries.push({ ...entry, path: resolved });
  }
  return {
    schema: 1,
    protocol: 'known_corpus',
    entries,
    cases: [],
    selection: { available: candidates.length, selected: entries.length, libraryRoot: root },
  };
}
