import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { TransitionPreviewDto } from '@/shared/contracts';

export const TRANSITION_PREVIEW_LIMIT = 24;
// v0.3.1 shipped cache manifest 1. All unreleased descriptor changes are the
// single manifest-2 format; implementation-only fixes must not advance it.
const manifestVersion = 2;
const thumbnailBounds = { width: 216, height: 288 } as const;
const detailBounds = { width: 648, height: 864 } as const;
const maximumThumbnailBytes = 1024 * 1024;
const maximumDetailBytes = 2 * 1024 * 1024;
const renditionRecipe = 'progressive-216x288-q72-648x864-q86-v1';
const temporaryRenditionFilePattern = /^[A-Za-z0-9_-]{16,64}\.jpg\.\d+-[0-9a-f-]{36}\.tmp$/;
// Eligibility is data provenance, not file format. Name it explicitly so a
// future policy change invalidates stale private media without inflating the
// structural manifest version.
const selectionPolicy = 'public-library-assets' as const;
// The renderer keeps the snapshot returned before a background refresh. Retain that generation
// plus the newly installed one so delayed IntersectionObserver requests never lose their URL.
const retainedGenerationLimit = 2;

const cacheEntrySchema = z
  .object({
    assetId: z.string().min(1),
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    fileName: z.string().regex(/^[A-Za-z0-9_-]{16,64}\.jpg$/),
    // Optional only so an existing manifest-2 thumbnail remains immediately
    // usable while the background refresh prepares its detail image.
    detailFileName: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,64}\.jpg$/)
      .optional(),
    detailWidth: z.number().int().positive().max(detailBounds.width).optional(),
    detailHeight: z.number().int().positive().max(detailBounds.height).optional(),
    renditionRecipe: z.literal(renditionRecipe).optional(),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal(manifestVersion),
    selectionPolicy: z.literal(selectionPolicy),
    entries: z.array(cacheEntrySchema).max(TRANSITION_PREVIEW_LIMIT),
  })
  .strict();

type CacheEntry = z.infer<typeof cacheEntrySchema>;
export type TransitionPreviewCandidate = ReturnType<LibraryDatabase['listTransitionPreviewSources']>[number];

function renditionSourceKey(source: Pick<CacheEntry, 'assetId' | 'path' | 'size' | 'mtimeMs'>) {
  return createHash('sha256')
    .update(`${renditionRecipe}\0${source.assetId}\0${source.path}\0${source.size}\0${source.mtimeMs}`)
    .digest('base64url')
    .slice(0, 32);
}

function registeredDetailFileName(entry: CacheEntry) {
  const expectedSourceKey = renditionSourceKey(entry);
  return entry.renditionRecipe === renditionRecipe &&
    entry.detailFileName === `${expectedSourceKey}-detail.jpg` &&
    entry.fileName === `${expectedSourceKey}.jpg` &&
    entry.detailWidth &&
    entry.detailHeight
    ? entry.detailFileName
    : entry.fileName;
}

async function mapTasks<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  task: (input: Input, index: number) => Promise<Output>,
) {
  const outputs = new Array<Output>(inputs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      outputs[index] = await task(inputs[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return outputs;
}

function sameSource(
  left: CacheEntry | undefined,
  right: { assetId: string; path: string; size: number; mtimeMs: number },
) {
  return Boolean(
    left &&
    left.assetId === right.assetId &&
    left.path === right.path &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs,
  );
}

function validateJpeg(bytes: Buffer, bounds: { width: number; height: number }, maximumBytes: number) {
  if (
    bytes.byteLength < 4 ||
    bytes.byteLength > maximumBytes ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    return null;
  }
  const decoded = nativeImage.createFromBuffer(bytes);
  const size = decoded.getSize();
  if (
    decoded.isEmpty() ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > bounds.width ||
    size.height > bounds.height
  ) {
    return null;
  }
  return size;
}

function resizeToBounds(image: Electron.NativeImage, bounds: { width: number; height: number }) {
  const source = image.getSize();
  const scale = Math.min(1, bounds.width / source.width, bounds.height / source.height);
  if (scale >= 1) return image;
  return image.resize({
    width: Math.max(1, Math.floor(source.width * scale)),
    height: Math.max(1, Math.floor(source.height * scale)),
    quality: 'good',
  });
}

async function publishRenditions(
  directory: string,
  thumbnail: { fileName: string; bytes: Buffer },
  detail: { fileName: string; bytes: Buffer },
) {
  const suffix = `${process.pid}-${randomUUID()}.tmp`;
  const thumbnailPath = path.join(directory, thumbnail.fileName);
  const detailPath = path.join(directory, detail.fileName);
  const temporaryThumbnailPath = `${thumbnailPath}.${suffix}`;
  const temporaryDetailPath = `${detailPath}.${suffix}`;
  try {
    const writes = await Promise.allSettled([
      writeFile(temporaryThumbnailPath, thumbnail.bytes),
      writeFile(temporaryDetailPath, detail.bytes),
    ]);
    const writeFailure = writes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (writeFailure) throw writeFailure.reason;
    await rename(temporaryDetailPath, detailPath);
    await rename(temporaryThumbnailPath, thumbnailPath);
  } finally {
    await Promise.all([rm(temporaryThumbnailPath, { force: true }), rm(temporaryDetailPath, { force: true })]);
  }
}

export class TransitionPreviewCache {
  private readonly files = new Map<string, string>();
  private readonly tokens = new Map<string, Set<string>>();
  private readonly generations = new Map<string, Array<{ key: string; tokens: string[]; fileNames: string[] }>>();
  private readonly items = new Map<string, TransitionPreviewDto[]>();
  private readonly refreshes = new Map<string, Promise<TransitionPreviewDto[] | null>>();

  constructor(private readonly root: string) {}

  resolveFile(token: string) {
    return this.files.get(token);
  }

  previewsFor(libraryId: string) {
    return (this.items.get(libraryId) ?? this.load(libraryId)).map((preview) => ({ ...preview }));
  }

  refresh(libraryId: string, candidates: readonly TransitionPreviewCandidate[]) {
    const current = this.refreshes.get(libraryId);
    if (current) return current;
    const refresh = this.refreshNow(libraryId, candidates)
      .catch((error) => {
        console.warn('[local-space] failed to refresh transition previews', { libraryId, error });
        return null;
      })
      .finally(() => {
        this.refreshes.delete(libraryId);
      });
    this.refreshes.set(libraryId, refresh);
    return refresh;
  }

  private directory(libraryId: string) {
    return path.join(this.root, Buffer.from(libraryId, 'utf8').toString('base64url'));
  }

  private manifestPath(libraryId: string) {
    return path.join(this.directory(libraryId), 'manifest.json');
  }

  private token(libraryId: string, fileName: string) {
    return createHash('sha256').update(`${libraryId}\0${fileName}`, 'utf8').digest('base64url').slice(0, 32);
  }

  private readManifest(libraryId: string) {
    try {
      return manifestSchema.parse(JSON.parse(readFileSync(this.manifestPath(libraryId), 'utf8')));
    } catch {
      return null;
    }
  }

  private async persistManifest(libraryId: string, entries: CacheEntry[]) {
    await mkdir(this.directory(libraryId), { recursive: true });
    await writeFile(
      this.manifestPath(libraryId),
      `${JSON.stringify({ version: manifestVersion, selectionPolicy, entries }, null, 2)}\n`,
      'utf8',
    );
  }

  private register(libraryId: string, entries: readonly CacheEntry[]) {
    const nextTokens = new Set<string>();
    const nextFileNames = new Set<string>();
    const previews = entries.slice(0, TRANSITION_PREVIEW_LIMIT).map((entry) => {
      const thumbnailToken = this.token(libraryId, entry.fileName);
      const detailFileName = registeredDetailFileName(entry);
      const detailToken = this.token(libraryId, detailFileName);
      nextTokens.add(thumbnailToken);
      nextTokens.add(detailToken);
      nextFileNames.add(entry.fileName);
      nextFileNames.add(detailFileName);
      this.files.set(thumbnailToken, path.join(this.directory(libraryId), entry.fileName));
      this.files.set(detailToken, path.join(this.directory(libraryId), detailFileName));
      return {
        url: `aiy-media://space-preview/${thumbnailToken}?revision=${path.basename(entry.fileName, '.jpg')}`,
        detailUrl: `aiy-media://space-preview/${detailToken}?revision=${path.basename(detailFileName, '.jpg')}`,
        width: entry.width,
        height: entry.height,
      } satisfies TransitionPreviewDto;
    });
    const generationKey = entries
      .slice(0, TRANSITION_PREVIEW_LIMIT)
      .map((entry) => `${entry.fileName}\0${registeredDetailFileName(entry)}`)
      .join('\0');
    const previousGenerations = this.generations.get(libraryId) ?? [];
    const latestGeneration = previousGenerations[previousGenerations.length - 1];
    const retainedGenerations =
      latestGeneration?.key === generationKey
        ? previousGenerations
        : [
            ...previousGenerations,
            { key: generationKey, tokens: [...nextTokens], fileNames: [...nextFileNames] },
          ].slice(-retainedGenerationLimit);
    const retainedTokens = new Set(retainedGenerations.flatMap((generation) => generation.tokens));
    for (const token of this.tokens.get(libraryId) ?? []) {
      if (!retainedTokens.has(token)) this.files.delete(token);
    }
    this.generations.set(libraryId, retainedGenerations);
    this.tokens.set(libraryId, retainedTokens);
    this.items.set(libraryId, previews);
    return previews.map((preview) => ({ ...preview }));
  }

  private retainedFileNames(libraryId: string) {
    return new Set((this.generations.get(libraryId) ?? []).flatMap((generation) => generation.fileNames));
  }

  private load(libraryId: string) {
    const manifest = this.readManifest(libraryId);
    return this.register(libraryId, manifest?.entries ?? []);
  }

  private async refreshNow(libraryId: string, candidates: readonly TransitionPreviewCandidate[]) {
    const directory = this.directory(libraryId);
    await mkdir(directory, { recursive: true });
    const previousByAssetId = new Map(
      (this.readManifest(libraryId)?.entries ?? []).map((entry) => [entry.assetId, entry] as const),
    );
    const entries = await mapTasks(candidates.slice(0, TRANSITION_PREVIEW_LIMIT), 2, (candidate) =>
      this.prepareEntry(libraryId, directory, candidate, previousByAssetId.get(candidate.assetId)),
    );
    const completeEntries = entries.filter((entry): entry is CacheEntry => Boolean(entry));
    await this.persistManifest(libraryId, completeEntries);
    const previews = this.register(libraryId, completeEntries);
    try {
      const retainedFiles = this.retainedFileNames(libraryId);
      const staleFiles = (await readdir(directory))
        .filter(
          (fileName) =>
            (fileName.endsWith('.jpg') && !retainedFiles.has(fileName)) || temporaryRenditionFilePattern.test(fileName),
        )
        .slice(0, 64);
      await mapTasks(staleFiles, 2, async (fileName) => {
        await unlink(path.join(directory, fileName)).catch(() => undefined);
      });
    } catch (error) {
      console.warn('[local-space] failed to clean stale transition previews', { libraryId, error });
    }
    return previews;
  }

  private async prepareEntry(
    libraryId: string,
    directory: string,
    candidate: TransitionPreviewCandidate,
    previous: CacheEntry | undefined,
  ): Promise<CacheEntry | null> {
    let fallback: CacheEntry | undefined;
    try {
      const sourcePath = path.resolve(candidate.sourcePath);
      const sourceStats = await stat(sourcePath);
      if (!sourceStats.isFile()) return null;
      const source = {
        assetId: candidate.assetId,
        path: sourcePath,
        size: sourceStats.size,
        mtimeMs: sourceStats.mtimeMs,
      };
      fallback = sameSource(previous, source) ? await this.usableThumbnailEntry(directory, previous) : undefined;
      const reusable = await this.reusableEntry(directory, source, previous, fallback);
      if (reusable) return reusable;
      const sourceKey = renditionSourceKey(source);
      const fileName = `${sourceKey}.jpg`;
      const detailFileName = `${sourceKey}-detail.jpg`;
      // Decode each arbitrary-size source once. The small first-paint image is
      // derived from the bounded detail image instead of decoding the source a
      // second time; mapTasks keeps at most two source decodes in flight.
      const detail = await nativeImage.createThumbnailFromPath(source.path, detailBounds);
      const detailSize = detail.getSize();
      if (
        detail.isEmpty() ||
        detailSize.width <= 0 ||
        detailSize.height <= 0 ||
        detailSize.width > detailBounds.width ||
        detailSize.height > detailBounds.height
      ) {
        return fallback ?? null;
      }
      const thumbnail = resizeToBounds(detail, thumbnailBounds);
      const thumbnailSize = thumbnail.getSize();
      if (
        thumbnail.isEmpty() ||
        thumbnailSize.width <= 0 ||
        thumbnailSize.height <= 0 ||
        thumbnailSize.width > thumbnailBounds.width ||
        thumbnailSize.height > thumbnailBounds.height
      ) {
        return fallback ?? null;
      }
      const thumbnailBytes = thumbnail.toJPEG(72);
      const detailBytes = detail.toJPEG(86);
      const encodedThumbnailSize = validateJpeg(thumbnailBytes, thumbnailBounds, maximumThumbnailBytes);
      const encodedDetailSize = validateJpeg(detailBytes, detailBounds, maximumDetailBytes);
      if (!encodedThumbnailSize || !encodedDetailSize) return fallback ?? null;
      await publishRenditions(
        directory,
        { fileName, bytes: thumbnailBytes },
        { fileName: detailFileName, bytes: detailBytes },
      );
      return {
        ...source,
        fileName,
        detailFileName,
        detailWidth: encodedDetailSize.width,
        detailHeight: encodedDetailSize.height,
        renditionRecipe,
        width: encodedThumbnailSize.width,
        height: encodedThumbnailSize.height,
      };
    } catch (error) {
      console.warn('[local-space] failed to prepare transition preview', {
        libraryId,
        sourcePath: candidate.sourcePath,
        error,
      });
      return fallback ?? null;
    }
  }

  private async usableThumbnailEntry(directory: string, previous: CacheEntry | undefined) {
    if (!previous) return undefined;
    const previousPath = path.join(directory, previous.fileName);
    const previousStats = await stat(previousPath).catch(() => null);
    if (!previousStats?.isFile() || previousStats.size > maximumThumbnailBytes) return undefined;
    const previousBytes = await readFile(previousPath).catch(() => null);
    const previousSize = previousBytes ? validateJpeg(previousBytes, thumbnailBounds, maximumThumbnailBytes) : null;
    if (previousSize?.width !== previous.width || previousSize.height !== previous.height) return undefined;
    const {
      detailFileName: _detailFileName,
      detailWidth: _detailWidth,
      detailHeight: _detailHeight,
      ...thumbnail
    } = previous;
    return thumbnail;
  }

  private async reusableEntry(
    directory: string,
    source: { assetId: string; path: string; size: number; mtimeMs: number },
    previous: CacheEntry | undefined,
    usableThumbnail: CacheEntry | undefined,
  ) {
    if (!sameSource(previous, source) || !usableThumbnail) return null;
    const detailFileName = previous?.detailFileName;
    const expectedDetailWidth = previous?.detailWidth;
    const expectedDetailHeight = previous?.detailHeight;
    const expectedSourceKey = renditionSourceKey(source);
    if (!detailFileName || detailFileName === previous!.fileName || !expectedDetailWidth || !expectedDetailHeight) {
      return null;
    }
    if (
      previous?.renditionRecipe !== renditionRecipe ||
      previous.fileName !== `${expectedSourceKey}.jpg` ||
      detailFileName !== `${expectedSourceKey}-detail.jpg`
    ) {
      return null;
    }
    const detailPath = path.join(directory, detailFileName);
    const detailStats = await stat(detailPath).catch(() => null);
    if (!detailStats?.isFile() || detailStats.size > maximumDetailBytes) return null;
    const detailBytes = await readFile(detailPath).catch(() => null);
    const detailSize = detailBytes ? validateJpeg(detailBytes, detailBounds, maximumDetailBytes) : null;
    return detailSize?.width === expectedDetailWidth && detailSize.height === expectedDetailHeight
      ? { ...previous! }
      : null;
  }
}
