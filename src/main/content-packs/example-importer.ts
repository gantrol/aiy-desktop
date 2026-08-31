import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ContentPackExample, ContentPackExamplesDocument } from '@/main/content-packs/example-manifest';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import { fixtureContentHash, type FixturePackSupplementalItem } from '@/main/database/packs/fixture-pack-source';

const MAX_EXAMPLE_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_EXAMPLE_ASSET_TOTAL_BYTES = 512 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PreparedContentPackExample {
  example: ContentPackExample;
  itemKey: string;
  sourcePath: string;
  byteSize: number;
  objectHash: string;
  assetId: string;
  mediaId: string;
  evidenceId: string;
  releaseItem: FixturePackSupplementalItem;
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function resolveExampleAsset(root: string, source: string) {
  if (path.isAbsolute(source)) throw new Error('Content pack example source must be asset-relative');
  const rootName = path.basename(root);
  const sourceRelative = source.startsWith(`${rootName}/`)
    ? source.slice(rootName.length + 1)
    : source.startsWith(`${rootName}\\`)
      ? source.slice(rootName.length + 1)
      : source;
  const candidate = path.resolve(root, sourceRelative);
  if (!isContained(root, candidate)) {
    throw new Error(`Content pack example source is outside the asset root: ${source}`);
  }
  const entry = await lstat(candidate);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Content pack example source is not a regular file: ${source}`);
  }
  if (entry.size <= 0 || entry.size > MAX_EXAMPLE_ASSET_BYTES) {
    throw new Error(`Content pack example has an invalid size: ${source}`);
  }
  const realFile = await realpath(candidate);
  if (!isContained(root, realFile)) {
    throw new Error(`Content pack example source is outside the asset root: ${source}`);
  }
  return { path: realFile, size: entry.size };
}

async function hashExampleAsset(sourcePath: string, expectedSize: number, source: string) {
  const hash = createHash('sha256');
  const signature = Buffer.alloc(pngSignature.byteLength);
  let signatureBytes = 0;
  let byteSize = 0;
  for await (const chunk of createReadStream(sourcePath, { highWaterMark: 1024 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (signatureBytes < signature.byteLength) {
      const copied = Math.min(signature.byteLength - signatureBytes, bytes.byteLength);
      bytes.copy(signature, signatureBytes, 0, copied);
      signatureBytes += copied;
    }
    byteSize += bytes.byteLength;
    if (byteSize > expectedSize) throw new Error(`Content pack example changed while being read: ${source}`);
    hash.update(bytes);
  }
  if (byteSize !== expectedSize || signatureBytes !== signature.byteLength || !signature.equals(pngSignature)) {
    throw new Error(`Content pack example must be a stable PNG file: ${source}`);
  }
  return hash.digest('hex');
}

function scopedId(prefix: string, packId: string, itemKey: string) {
  return `${prefix}_${fixtureContentHash({ packId, itemKey }).slice(0, 40)}`;
}

function normalizedRole(example: ContentPackExample) {
  if (example.status === 'REJECTED') {
    if (example.role && example.role !== 'NEGATIVE_EVIDENCE') {
      throw new Error(`Rejected content example has an invalid role: ${example.assetId}`);
    }
    return 'NEGATIVE_EVIDENCE' as const;
  }
  if (example.role === 'NEGATIVE_EVIDENCE') {
    throw new Error(`Accepted content example cannot use NEGATIVE_EVIDENCE: ${example.assetId}`);
  }
  return example.role === 'COVER' ? ('COVER' as const) : ('RELATED' as const);
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  transform: (item: Input, index: number) => Promise<Output>,
) {
  const output = new Array<Output>(items.length);
  let nextIndex = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (failure === undefined && nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          output[index] = await transform(items[index], index);
        } catch (reason) {
          failure = reason ?? new Error('Content pack asset processing failed');
        }
      }
    }),
  );
  if (failure !== undefined) throw failure;
  return output;
}

export async function prepareContentPackExamples(
  packId: string,
  document: ContentPackExamplesDocument | undefined,
  assetsRoot: string | undefined,
) {
  if (!document) return [];
  if (!assetsRoot) throw new Error('Content pack examples require an asset root');

  const itemKeys = new Set<string>();
  const coverTerms = new Set<string>();
  const identities = document.examples.map((example) => {
    const role = normalizedRole(example);
    if (role === 'COVER') {
      if (coverTerms.has(example.termStableKey)) {
        throw new Error(`Content pack examples contain multiple covers for one term: ${example.termStableKey}`);
      }
      coverTerms.add(example.termStableKey);
    }
    const logicalKey = example.key ?? example.evidenceId ?? example.mediaId ?? example.assetId;
    const itemKey = `example:${example.termStableKey}:${logicalKey}`;
    if (itemKeys.has(itemKey)) throw new Error(`Duplicate content pack example identity: ${itemKey}`);
    itemKeys.add(itemKey);

    return { example, role, logicalKey, itemKey };
  });
  const resolved = await mapWithConcurrency(identities, 2, async (identity) => ({
    ...identity,
    resolved: await resolveExampleAsset(assetsRoot, identity.example.source),
  }));
  const totalBytes = resolved.reduce((total, item) => total + item.resolved.size, 0);
  if (totalBytes > MAX_EXAMPLE_ASSET_TOTAL_BYTES) {
    throw new Error('Content pack example assets exceed the total byte budget');
  }
  return mapWithConcurrency(
    resolved,
    2,
    async ({ example, role, logicalKey, itemKey, resolved: asset }): Promise<PreparedContentPackExample> => {
      const objectHash = await hashExampleAsset(asset.path, asset.size, example.source);
      const assetId = `pack_asset_${objectHash}`;
      const mediaId = scopedId('tml_pack', packId, itemKey);
      const evidenceId = scopedId('te_pack', packId, itemKey);
      const semanticHash = fixtureContentHash({
        contract: 'CONTENT_PACK_EXAMPLE_V2',
        termStableKey: example.termStableKey,
        logicalKey,
        status: example.status,
        role,
        note: example.note ?? '',
        objectHash,
      });
      const metadata: JsonMap = {
        contract: 'CONTENT_PACK_EXAMPLE_V2',
        termStableKey: example.termStableKey,
        exampleKey: logicalKey,
        status: example.status,
        role,
        note: example.note ?? '',
        assetId,
        mediaId,
        evidenceId,
        objectHash,
      };
      return {
        example,
        itemKey,
        sourcePath: asset.path,
        byteSize: asset.size,
        objectHash,
        assetId,
        mediaId,
        evidenceId,
        releaseItem: {
          itemKey,
          objectType: 'TERM_EXAMPLE',
          objectRevisionId: `content-example:${semanticHash.slice(0, 32)}`,
          contentHash: `sha256:${semanticHash}`,
          inclusionKind: 'EXAMPLE',
          visibility: 'VISIBLE',
          rightsStatus: 'UNKNOWN',
          metadata,
          provenance: { source: 'CONTENT_PACKAGE', packageId: packId, sourcePath: example.source },
          localObjectType: 'IMAGE_ASSET',
          localObjectId: assetId,
          localRevisionId: assetId,
        },
      };
    },
  );
}

function assertTermsExist(storage: LibraryStorage, examples: readonly PreparedContentPackExample[]) {
  const stableKeys = [...new Set(examples.map((item) => item.example.termStableKey))];
  const found = new Set<string>();
  for (let offset = 0; offset < stableKeys.length; offset += 500) {
    const chunk = stableKeys.slice(offset, offset + 500);
    const slots = chunk.map(() => '?').join(', ');
    const rows = storage.db
      .prepare(`SELECT stable_key FROM terms WHERE stable_key IN (${slots})`)
      .all(...chunk) as JsonMap[];
    for (const row of rows) found.add(text(row.stable_key));
  }
  const missing = stableKeys.filter((stableKey) => !found.has(stableKey));
  if (missing.length) {
    throw new Error(`Content pack examples reference unknown terms: ${missing.slice(0, 5).join(', ')}`);
  }
}

export interface StagedContentPackExampleAsset {
  item: PreparedContentPackExample;
  stored: StoredObject;
}

export async function stageContentPackExampleAssets(
  storage: LibraryStorage,
  examples: readonly PreparedContentPackExample[],
) {
  return mapWithConcurrency(examples, 2, async (item): Promise<StagedContentPackExampleAsset> => {
    const bytes = await readFile(item.sourcePath);
    if (bytes.byteLength !== item.byteSize || !bytes.subarray(0, pngSignature.byteLength).equals(pngSignature)) {
      throw new Error(`Content pack example changed after preview: ${item.example.source}`);
    }
    const stored = await storage.storeBufferAsync(bytes, '.png');
    if (stored.hash !== item.objectHash || stored.width <= 0 || stored.height <= 0 || stored.byteSize <= 0) {
      throw new Error(`Content pack example could not be decoded: ${item.example.source}`);
    }
    return { item, stored };
  });
}

export function commitContentPackExampleAssets(
  storage: LibraryStorage,
  stagedAssets: readonly StagedContentPackExampleAsset[],
) {
  assertTermsExist(
    storage,
    stagedAssets.map(({ item }) => item),
  );
  for (const { item, stored } of stagedAssets) {
    const existing = storage.db.prepare('SELECT object_hash FROM image_assets WHERE id = ?').get(item.assetId) as
      JsonMap | undefined;
    if (existing && text(existing.object_hash) !== item.objectHash) {
      throw new Error(`Content-addressed example asset conflicts with existing content: ${item.assetId}`);
    }
    storage.db
      .prepare(
        `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES (?, 'REFERENCE', 'EXTERNAL_IMPORT', ?, ?, ?, ?, 'image/png', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET relative_path = excluded.relative_path,
          width = excluded.width, height = excluded.height, mime_type = excluded.mime_type,
          byte_size = excluded.byte_size, deleted_at = NULL`,
      )
      .run(item.assetId, item.objectHash, stored.relativePath, stored.width, stored.height, stored.byteSize, now());
  }
}
