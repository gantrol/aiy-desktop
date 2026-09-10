import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256HexAsync } from '@/main/database/core/storage';
import { noteFileSchema, type NoteFile } from '@/shared/contracts/note-files';
import { petalError } from '@/shared/petal-errors';

const mimeTypes: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
};
// A separate object namespace prevents image lifecycle cleanup from deleting note files.
export function noteFilePath(libraryRoot: string, file: NoteFile) {
  const value = noteFileSchema.parse(file);
  return path.join(libraryRoot, 'objects', 'note-files', value.hash.slice(0, 2), `${value.hash}${value.extension}`);
}
export async function storeNoteFile(libraryRoot: string, name: string, bytes: Uint8Array): Promise<NoteFile> {
  const suffix = path.extname(name).toLowerCase();
  const extension = /^\.[a-z0-9]{1,16}$/.test(suffix) ? suffix : '.bin';
  const file = noteFileSchema.parse({
    id: randomUUID(),
    name,
    extension,
    hash: await sha256HexAsync(bytes),
    mimeType: mimeTypes[extension] ?? 'application/octet-stream',
    byteSize: bytes.byteLength,
  });
  const destination = noteFilePath(libraryRoot, file);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(destination, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return file;
}
export async function resolveNoteFile(libraryRoot: string, file: NoteFile) {
  const destination = noteFilePath(libraryRoot, file);
  if (/trash/i.test(destination)) throw petalError('sourceUnavailable');
  const resolved = await realpath(destination);
  const root = await realpath(path.join(libraryRoot, 'objects', 'note-files'));
  const relative = path.relative(root, resolved);
  if (/trash/i.test(resolved) || relative.startsWith('..') || path.isAbsolute(relative))
    throw petalError('sourceUnavailable');
  const info = await stat(resolved);
  if (!info.isFile() || info.size !== file.byteSize) throw petalError('sourceUnavailable');
  return resolved;
}
