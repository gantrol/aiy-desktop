import { readFile } from 'node:fs/promises';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { contentImageImports } from '@/main/creations/content-image-imports';
import { storeNoteFile } from '@/main/desktop-petals/note-file-store';
import { blockDocumentSchema, blockDocumentAssetIds } from '@/shared/contracts/block-document';
import { petalError } from '@/shared/petal-errors';
import { contentAssetPath } from '@/shared/content-asset-path';
import { rewriteArticleImageReferences } from '@/main/creations/article-media-references';
import type { TemporaryManifest } from '@/main/temporary-files/temporary-file-record';
import { archiveTemporaryImageEdit } from '@/main/temporary-files/temporary-image-archive';
import type { ImageEditRecord } from '@/shared/contracts/image-edit';

/** Durable intent plus the existing idempotent create/import APIs makes interrupted promotion retryable. */
export async function promoteTemporaryFile(
  store: TemporaryFilesStore,
  id: string,
  expectedHash: string,
  context: ActiveLibraryContext,
) {
  const manifest = store.manifest(id);
  const { note, draft, imageEdit } = await store.body(id);
  if (draft || imageEdit?.draft || note.contentHash !== expectedHash) throw petalError('unsaved');
  if (manifest.promotion && manifest.promotion.libraryId !== context.library.id) throw petalError('wrongLibrary');
  await store.updateManifest({ ...manifest, promotion: { libraryId: context.library.id, ...manifest.promotion } });
  try {
    return await copyTemporaryContent(store, manifest, note, context, imageEdit);
  } catch (error) {
    // A failed import before the target exists leaves the draft editable. Once a target exists,
    // keep the intent and lock input until the same idempotent transition is retried.
    const targetExists =
      store.manifest(id).promotion?.targetId ||
      (manifest.kind === 'NOTE' && context.database.listDesktopNoteIds().includes(id));
    if (!targetExists && manifest.kind === 'NOTE')
      await store.updateManifest({ ...store.manifest(id), promotion: undefined });
    if (targetExists || manifest.kind === 'IMAGE') throw petalError('temporaryPromotionPending');
    throw error;
  }
}

async function copyTemporaryContent(
  store: TemporaryFilesStore,
  manifest: TemporaryManifest,
  note: DesktopNote,
  context: ActiveLibraryContext,
  imageEdit?: ImageEditRecord,
) {
  const id = manifest.id;
  const references = new Map<string, string>();
  const paths = new Map<string, string>();
  const imports = contentImageImports(context.database);
  const requiredImages = new Set([
    ...note.references.map((item) => item.assetId),
    ...(note.document ? blockDocumentAssetIds(note.document) : []),
  ]);
  for (const file of manifest.attachments.filter((item) => item.asset && requiredImages.has(item.id))) {
    const bytes = await readFile(store.file(file.id, 'bin'));
    await imports.stage({
      importId: file.id,
      source: 'UPLOAD',
      item: { name: file.name, mimeType: file.asset!.mimeType as 'image/png', bytes },
    });
    references.set(file.id, (await imports.resolve(file.id)).id);
    paths.set(file.asset!.mediaUrl, contentAssetPath(references.get(file.id)!));
    paths.set(contentAssetPath(file.id), contentAssetPath(references.get(file.id)!));
  }
  if (imageEdit && references.has(imageEdit.resultAssetId))
    await archiveTemporaryImageEdit(
      store,
      id,
      context.database.libraryRoot,
      imageEdit,
      references.get(imageEdit.resultAssetId)!,
    );
  if (manifest.kind === 'IMAGE') {
    const assetId = references.get(note.references[0]?.assetId);
    if (!assetId) throw petalError('sourceUnavailable');
    const targetId = context.database.petalBoard.pin({ kind: 'IMAGE', id: assetId }, 'default');
    context.database.petalBoard.appearance(targetId, { color: note.color, icon: note.icon });
    await store.updateManifest({ ...store.manifest(id), promotion: { libraryId: context.library.id, targetId } });
    return { targetId, note: null };
  }
  const files = [];
  for (const file of note.files ?? []) {
    const saved = await storeNoteFile(
      context.database.libraryRoot,
      file.name,
      await readFile(store.file(file.id, 'bin')),
    );
    files.push({ ...saved, id: file.id });
  }
  // Only structured asset identities and internal media URLs are rewritten; arbitrary user text is preserved.
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if ((key === 'assetId' || key === 'id') && typeof item === 'string' && references.has(item))
            return [key, references.get(item)];
          if (['src', 'mediaUrl', 'mediaPath', 'sourcePath'].includes(key) && typeof item === 'string') {
            if (paths.has(item)) return [key, paths.get(item)];
            const file = manifest.attachments.find((attachment) => attachment.asset?.mediaUrl === item);
            if (file && references.has(file.id)) return [key, `aiy-media://asset/${references.get(file.id)}`];
          }
          return [key, rewrite(item)];
        }),
      );
    return value;
  };
  const text =
    note.format === 'markdown'
      ? rewriteArticleImageReferences(
          note.text,
          paths,
          new Map([...references].map(([from, to]) => [from, contentAssetPath(to)])),
        )
      : note.text;
  const saved: DesktopNote = context.database.createDesktopNote(id, undefined, {
    text,
    title: note.title,
    format: note.format,
    document: note.document ? blockDocumentSchema.parse(rewrite(note.document)) : undefined,
    referenceAssetIds: note.references.map((item) => references.get(item.assetId)!),
    files,
    color: note.color,
    icon: note.icon,
  });
  await store.updateManifest({
    ...store.manifest(id),
    promotion: { libraryId: context.library.id, targetId: saved.id },
  });
  return { targetId: saved.id, note: saved };
}
