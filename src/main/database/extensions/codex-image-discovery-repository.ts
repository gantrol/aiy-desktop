import { randomUUID } from 'node:crypto';
import type {
  CodexGeneratedImageRecoveryTargetDto,
  CodexImageDiscoveryFilter,
  CodexTaskReferenceDto,
  NewExternalCreationImportInput,
} from '@/shared/contracts';
import type { CreationImportRepository } from '@/main/database/creations/creation-import-repository';
import type { StoredCreatorImage } from '@/main/database/creations/creation-import-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, type JsonMap, text } from '@/main/database/core/values';
import type { WorkbenchRepository } from '@/main/database/generation/workbench-repository';
import { CODEX_APP_SERVER_EXTENSION_ID, CODEX_APP_SERVER_IMAGE_MODEL_KEY } from '@/shared/extension-ids';

export type CodexDiscoveredImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CodexImageScanEntry {
  id: string;
  contentHash: string;
  threadId: string;
  threadName: string;
  relativePath: string;
  fileName: string;
  mimeType: CodexDiscoveredImageMimeType;
  byteSize: number;
  fileCreatedAt: string;
  fileModifiedAt: string;
}

export interface CodexImageDiscoveryThreadDirectorySnapshot {
  threadId: string;
  modifiedAt: string;
}

export interface CodexImageDiscoveryScanSnapshot {
  rootPath: string;
  lastScannedAt: string;
  threadDirectories: CodexImageDiscoveryThreadDirectorySnapshot[];
}

export interface CodexImageDiscoveryRecord extends CodexImageScanEntry {
  importedSeriesId: string | null;
  importedAssetId: string | null;
  importedOutputId: string | null;
  importedAt: string | null;
  discoveredAt: string;
  updatedAt: string;
  missingAt: string | null;
  inLibrary: boolean;
  libraryAssetId: string | null;
  recoveryTarget?: CodexImageRecoveryTarget | null;
}

export interface CodexImageRecoveryTarget extends CodexGeneratedImageRecoveryTargetDto {
  sourceAssetId: string | null;
}

interface DiscoveryRow {
  id: string;
  thread_id: string;
  thread_name: string;
  relative_path: string;
  file_name: string;
  mime_type: CodexDiscoveredImageMimeType;
  byte_size: number;
  file_created_at: string;
  file_modified_at: string;
  content_hash: string | null;
  imported_series_id: string | null;
  imported_asset_id: string | null;
  imported_output_id: string | null;
  imported_at: string | null;
  discovered_at: string;
  updated_at: string;
  missing_at: string | null;
  library_asset_id?: string | null;
}

interface RecoveryTargetRow {
  thread_id: string;
  run_id: string;
  series_id: string;
  version_id: string;
  version_no: number;
  creation_title: string;
  creation_title_locale: string;
  user_intent: string;
  final_prompt: string;
  source_asset_id: string | null;
  model_key: string;
  created_at: string;
}

const LAST_SCANNED_AT_META_KEY = 'codex_image_discovery_last_scanned_at';
const DIRECTORY_SNAPSHOT_META_KEY = 'codex_image_discovery_thread_directory_snapshot';
const DIRECTORY_SNAPSHOT_VERSION = 1;

export class CodexImageDiscoveryRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly creationImports: CreationImportRepository,
    private readonly workbench: WorkbenchRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  reconcileScan(
    scanId: string,
    entries: readonly CodexImageScanEntry[],
    complete = true,
    scanSnapshot?: CodexImageDiscoveryScanSnapshot,
  ) {
    return this.db
      .transaction(() => {
        const timestamp = now();
        const seenRelativePaths = new Set<string>();
        const findExisting = this.db.prepare(`SELECT * FROM codex_image_discoveries
        WHERE relative_path = ?`);
        const insertDiscovery = this.db.prepare(`INSERT INTO codex_image_discoveries(
        id, thread_id, thread_name, relative_path, file_name, mime_type, byte_size,
        file_created_at, file_modified_at, content_hash, imported_series_id,
        imported_asset_id, imported_output_id, imported_at, last_seen_scan_id,
        discovered_at, updated_at, missing_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)`);
        const updateDiscovery = this.db.prepare(`UPDATE codex_image_discoveries SET
        thread_id = ?, thread_name = ?, file_name = ?, mime_type = ?, byte_size = ?,
        file_created_at = ?, file_modified_at = ?, content_hash = ?, imported_series_id = ?,
        imported_asset_id = ?, imported_output_id = ?, imported_at = ?, last_seen_scan_id = ?,
        updated_at = ?, missing_at = NULL
        WHERE id = ?`);
        const listActiveDiscoveries = this.db.prepare(`SELECT id, relative_path
        FROM codex_image_discoveries WHERE missing_at IS NULL`);
        const markMissing = this.db.prepare(`UPDATE codex_image_discoveries
        SET missing_at = ?, updated_at = ? WHERE id = ?`);
        const insertEvent = this.db.prepare(`INSERT INTO codex_image_discovery_events(
        id, discovery_id, event_kind, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`);
        const upsertMeta = this.db.prepare(`INSERT INTO app_meta(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
        const recordScanEvent = (
          discoveryId: string,
          eventKind: 'DISCOVERED' | 'UPDATED' | 'MISSING' | 'RESTORED',
          payload: JsonMap,
        ) => {
          insertEvent.run(randomUUID(), discoveryId, eventKind, JSON.stringify(payload), timestamp);
        };
        let changed = 0;
        for (const entry of entries) {
          seenRelativePaths.add(entry.relativePath);
          const existing = findExisting.get(entry.relativePath) as DiscoveryRow | undefined;
          if (!existing) {
            insertDiscovery.run(
              entry.id,
              entry.threadId,
              entry.threadName,
              entry.relativePath,
              entry.fileName,
              entry.mimeType,
              entry.byteSize,
              entry.fileCreatedAt,
              entry.fileModifiedAt,
              entry.contentHash,
              scanId,
              timestamp,
              timestamp,
            );
            recordScanEvent(entry.id, 'DISCOVERED', {
              threadId: entry.threadId,
              relativePath: entry.relativePath,
            });
            changed += 1;
            continue;
          }

          const contentChanged = existing.content_hash !== null && existing.content_hash !== entry.contentHash;
          const metadataChanged =
            contentChanged ||
            existing.content_hash !== entry.contentHash ||
            existing.byte_size !== entry.byteSize ||
            existing.file_modified_at !== entry.fileModifiedAt ||
            existing.mime_type !== entry.mimeType ||
            existing.thread_id !== entry.threadId ||
            existing.thread_name !== entry.threadName ||
            existing.file_name !== entry.fileName ||
            existing.file_created_at !== entry.fileCreatedAt;
          const restored = existing.missing_at !== null;
          if (!metadataChanged && !restored) continue;
          updateDiscovery.run(
            entry.threadId,
            entry.threadName,
            entry.fileName,
            entry.mimeType,
            entry.byteSize,
            entry.fileCreatedAt,
            entry.fileModifiedAt,
            entry.contentHash,
            contentChanged ? null : existing.imported_series_id,
            contentChanged ? null : existing.imported_asset_id,
            contentChanged ? null : existing.imported_output_id,
            contentChanged ? null : existing.imported_at,
            scanId,
            timestamp,
            existing.id,
          );
          if (restored) {
            recordScanEvent(existing.id, 'RESTORED', { relativePath: entry.relativePath });
            changed += 1;
          } else if (metadataChanged) {
            recordScanEvent(existing.id, 'UPDATED', {
              relativePath: entry.relativePath,
              contentChanged,
            });
            changed += 1;
          }
        }

        const missing = complete
          ? (listActiveDiscoveries.all() as JsonMap[]).filter((row) => !seenRelativePaths.has(text(row.relative_path)))
          : [];
        for (const row of missing) {
          const discoveryId = text(row.id);
          markMissing.run(timestamp, timestamp, discoveryId);
          recordScanEvent(discoveryId, 'MISSING', { relativePath: text(row.relative_path) });
        }
        if (complete && scanSnapshot) {
          upsertMeta.run(LAST_SCANNED_AT_META_KEY, scanSnapshot.lastScannedAt);
          upsertMeta.run(
            DIRECTORY_SNAPSHOT_META_KEY,
            JSON.stringify({
              version: DIRECTORY_SNAPSHOT_VERSION,
              rootPath: scanSnapshot.rootPath,
              threadDirectories: scanSnapshot.threadDirectories,
            }),
          );
        }
        return { changed: changed + missing.length };
      })
      .immediate();
  }

  scanSnapshot(): CodexImageDiscoveryScanSnapshot | null {
    const rows = this.db
      .prepare(
        `SELECT key, value FROM app_meta
      WHERE key IN (?, ?)`,
      )
      .all(LAST_SCANNED_AT_META_KEY, DIRECTORY_SNAPSHOT_META_KEY) as JsonMap[];
    const values = new Map(rows.map((row) => [text(row.key), text(row.value)]));
    const lastScannedAt = values.get(LAST_SCANNED_AT_META_KEY) ?? '';
    const serializedSnapshot = values.get(DIRECTORY_SNAPSHOT_META_KEY) ?? '';
    if (!lastScannedAt || !Number.isFinite(Date.parse(lastScannedAt)) || !serializedSnapshot) return null;
    try {
      const parsed = JSON.parse(serializedSnapshot) as {
        version?: unknown;
        rootPath?: unknown;
        threadDirectories?: unknown;
      };
      if (
        parsed.version !== DIRECTORY_SNAPSHOT_VERSION ||
        typeof parsed.rootPath !== 'string' ||
        !parsed.rootPath ||
        !Array.isArray(parsed.threadDirectories)
      )
        return null;
      const threadDirectories: CodexImageDiscoveryThreadDirectorySnapshot[] = [];
      const seenThreadIds = new Set<string>();
      for (const value of parsed.threadDirectories) {
        if (
          !value ||
          typeof value !== 'object' ||
          typeof (value as { threadId?: unknown }).threadId !== 'string' ||
          !(value as { threadId: string }).threadId ||
          typeof (value as { modifiedAt?: unknown }).modifiedAt !== 'string' ||
          !Number.isFinite(Date.parse((value as { modifiedAt: string }).modifiedAt))
        )
          return null;
        const entry = value as CodexImageDiscoveryThreadDirectorySnapshot;
        if (seenThreadIds.has(entry.threadId)) return null;
        seenThreadIds.add(entry.threadId);
        threadDirectories.push({ threadId: entry.threadId, modifiedAt: entry.modifiedAt });
      }
      threadDirectories.sort((left, right) => left.threadId.localeCompare(right.threadId));
      return {
        rootPath: parsed.rootPath,
        lastScannedAt,
        threadDirectories,
      };
    } catch {
      return null;
    }
  }

  hashCache() {
    const rows = this.db
      .prepare(
        `SELECT relative_path, mime_type, byte_size, file_modified_at, content_hash
      FROM codex_image_discoveries
      WHERE missing_at IS NULL AND content_hash IS NOT NULL`,
      )
      .all() as Array<{
      relative_path: string;
      mime_type: CodexDiscoveredImageMimeType;
      byte_size: number;
      file_modified_at: string;
      content_hash: string;
    }>;
    return new Map(
      rows.map((row) => [
        row.relative_path,
        {
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size),
          fileModifiedAt: row.file_modified_at,
          contentHash: row.content_hash,
        },
      ]),
    );
  }

  list(
    requestedPage = 1,
    pageSize = 24,
    filter: CodexImageDiscoveryFilter = 'NOT_IN_LIBRARY',
    includeUntitled = false,
  ) {
    const counts = this.db
      .prepare(
        `WITH visible_discoveries AS (
        SELECT *
        FROM codex_image_discoveries discovery
        WHERE discovery.missing_at IS NULL
          AND (? = 1 OR discovery.thread_name <> ('Codex ' || substr(discovery.thread_id, 1, 8)))
      ), unique_discoveries AS (
        SELECT COALESCE(discovery.content_hash, discovery.id) AS discovery_key,
          discovery.content_hash
        FROM visible_discoveries discovery
        GROUP BY COALESCE(discovery.content_hash, discovery.id)
      ), active_hashes AS (
        SELECT asset.object_hash
        FROM image_assets asset
        WHERE asset.deleted_at IS NULL
        GROUP BY asset.object_hash
      )
      SELECT
        (SELECT count(*) FROM visible_discoveries) AS file_count,
        (SELECT count(DISTINCT thread_id)
          FROM codex_image_discoveries
          WHERE missing_at IS NULL
            AND thread_name = ('Codex ' || substr(thread_id, 1, 8))) AS untitled_thread_count,
        count(*) AS total_count,
        sum(CASE WHEN active_hashes.object_hash IS NOT NULL THEN 1 ELSE 0 END) AS in_library_count,
        sum(CASE WHEN active_hashes.object_hash IS NULL THEN 1 ELSE 0 END) AS unimported_count
      FROM unique_discoveries
      LEFT JOIN active_hashes ON active_hashes.object_hash = unique_discoveries.content_hash`,
      )
      .get(includeUntitled ? 1 : 0) as JsonMap;
    const fileCount = Number(counts.file_count ?? 0);
    const untitledThreadCount = Number(counts.untitled_thread_count ?? 0);
    const totalCount = Number(counts.total_count ?? 0);
    const inLibraryCount = Number(counts.in_library_count ?? 0);
    const unimportedCount = Number(counts.unimported_count ?? 0);
    const filteredCount = filter === 'ALL' ? totalCount : filter === 'IN_LIBRARY' ? inLibraryCount : unimportedCount;
    const pageCount = Math.ceil(filteredCount / pageSize);
    const page = pageCount === 0 ? 1 : Math.min(Math.max(1, requestedPage), pageCount);
    const rows = this.db
      .prepare(
        `WITH ranked AS (
        SELECT discovery.*,
          row_number() OVER (
            PARTITION BY COALESCE(discovery.content_hash, discovery.id)
            ORDER BY discovery.file_modified_at DESC, discovery.id DESC
          ) AS hash_rank
        FROM codex_image_discoveries discovery
        WHERE discovery.missing_at IS NULL
          AND (? = 1 OR discovery.thread_name <> ('Codex ' || substr(discovery.thread_id, 1, 8)))
      ), active_assets AS (
        SELECT asset.id, asset.object_hash,
          row_number() OVER (
            PARTITION BY asset.object_hash
            ORDER BY asset.created_at DESC, asset.id DESC
          ) AS asset_rank
        FROM image_assets asset
        WHERE asset.deleted_at IS NULL
      ), unique_discoveries AS (
        SELECT ranked.*, active_asset.id AS library_asset_id
        FROM ranked
        LEFT JOIN active_assets active_asset
          ON active_asset.object_hash = ranked.content_hash AND active_asset.asset_rank = 1
        WHERE ranked.hash_rank = 1
      )
      SELECT * FROM unique_discoveries
      WHERE ? = 'ALL'
        OR (? = 'IN_LIBRARY' AND library_asset_id IS NOT NULL)
        OR (? = 'NOT_IN_LIBRARY' AND library_asset_id IS NULL)
      ORDER BY file_modified_at DESC, id DESC
      LIMIT ? OFFSET ?`,
      )
      .all(includeUntitled ? 1 : 0, filter, filter, filter, pageSize, (page - 1) * pageSize) as DiscoveryRow[];
    const recoveryTargets = this.recoveryTargets(rows.map((row) => row.thread_id));
    return {
      records: rows.map((row) => this.map(row, recoveryTargets.get(row.thread_id) ?? null)),
      filter,
      includeUntitled,
      page,
      pageSize,
      pageCount,
      fileCount,
      duplicateCount: Math.max(0, fileCount - totalCount),
      totalCount,
      filteredCount,
      inLibraryCount,
      unimportedCount,
      untitledThreadCount,
    };
  }

  get(discoveryIds: readonly string[]) {
    if (!discoveryIds.length) return [];
    const placeholders = discoveryIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT discovery.*,
        (SELECT asset.id FROM image_assets asset
          WHERE asset.object_hash = discovery.content_hash AND asset.deleted_at IS NULL
          ORDER BY asset.created_at DESC, asset.id DESC LIMIT 1) AS library_asset_id
      FROM codex_image_discoveries discovery
      WHERE discovery.id IN (${placeholders}) AND discovery.missing_at IS NULL`,
      )
      .all(...discoveryIds) as DiscoveryRow[];
    const recoveryTargets = this.recoveryTargets(rows.map((row) => row.thread_id));
    const byId = new Map(rows.map((row) => [row.id, this.map(row, recoveryTargets.get(row.thread_id) ?? null)]));
    return discoveryIds.flatMap((id) => byId.get(id) ?? []);
  }

  importStoredImages(
    input: NewExternalCreationImportInput,
    images: StoredCreatorImage[],
    bindings: readonly { discoveryId: string; contentHash: string }[],
    codexTask: CodexTaskReferenceDto,
  ) {
    return this.db
      .transaction(() => {
        const findExistingAsset = this.db.prepare(`SELECT id FROM image_assets
        WHERE object_hash = ? AND deleted_at IS NULL LIMIT 1`);
        for (const binding of bindings) {
          if (findExistingAsset.get(binding.contentHash)) {
            throw new Error('One or more Codex images already exist in the library');
          }
        }
        const result = this.creationImports.importStoredNewExternalCreation(input, images, 0, codexTask);
        if (result.importedOutputs.length !== bindings.length) {
          throw new Error('Codex image import changed while it was being saved');
        }
        for (const [index, output] of result.importedOutputs.entries()) {
          const binding = bindings[index]!;
          // The durable task proves the Codex source, but the discovery payload
          // does not identify the underlying image model. Preserve any model
          // the user already declared; never manufacture a model default.
          this.creationImports.updateOutput(
            {
              outputId: output.id,
              promptVersionId: result.versionId,
              displayName: output.displayName,
              note: output.note,
              sourceUrl: output.sourceUrl,
              aiGeneratedStatus: 'YES',
              comparisonRole: output.modelName.trim() ? 'MODEL' : 'UNKNOWN',
              modelName: output.modelName,
              modelProvider: 'Codex',
              modelVersion: output.modelVersion,
              generationTextType: output.generationTextType,
              generationText: output.generationText,
            },
            {
              provenanceConfidence:
                output.provenanceConfidence === 'UNKNOWN' ? 'VERIFIED' : output.provenanceConfidence,
            },
          );
          this.markImported({
            discoveryId: binding.discoveryId,
            contentHash: binding.contentHash,
            seriesId: result.seriesId,
            assetId: output.imageAssetId,
            outputId: output.id,
          });
        }
        return result;
      })
      .immediate();
  }

  recoverStoredGeneration(discoveryId: string, image: StoredCreatorImage) {
    return this.db
      .transaction(() => {
        if (image.item.id !== discoveryId || image.item.mimeType !== 'image/png') {
          throw new Error('Only the selected PNG can repair this generation');
        }
        const record = this.get([discoveryId])[0];
        if (!record || record.missingAt) throw new Error('Discovered Codex image is unavailable');
        if (record.inLibrary) throw new Error('This Codex image already exists in the library');
        if (!record.recoveryTarget) throw new Error('This Codex image no longer matches a recoverable generation');
        if (record.contentHash !== image.stored.hash) throw new Error('Codex image content changed before recovery');

        const target = record.recoveryTarget;
        const asset = this.workbench.finishGenerationFromStoredImage(
          target.runId,
          image.stored,
          'image/png',
          target.sourceAssetId,
        );
        this.markRecovered({
          discoveryId,
          contentHash: record.contentHash,
          runId: target.runId,
          seriesId: target.seriesId,
          assetId: asset.id,
        });
        return {
          discoveryId,
          runId: target.runId,
          seriesId: target.seriesId,
          versionId: target.versionId,
          assetId: asset.id,
        };
      })
      .immediate();
  }

  markImported(input: {
    discoveryId: string;
    contentHash: string;
    seriesId: string;
    assetId: string;
    outputId: string;
  }) {
    const timestamp = now();
    const result = this.db
      .prepare(
        `UPDATE codex_image_discoveries SET
      content_hash = ?, imported_series_id = ?, imported_asset_id = ?, imported_output_id = ?,
      imported_at = ?, updated_at = ?
      WHERE id = ? AND content_hash = ? AND missing_at IS NULL`,
      )
      .run(
        input.contentHash,
        input.seriesId,
        input.assetId,
        input.outputId,
        timestamp,
        timestamp,
        input.discoveryId,
        input.contentHash,
      );
    if (!result.changes) throw new Error('Discovered Codex image changed or is no longer available');
    this.recordEvent(
      input.discoveryId,
      'IMPORTED',
      {
        seriesId: input.seriesId,
        assetId: input.assetId,
        outputId: input.outputId,
        contentHash: input.contentHash,
      },
      timestamp,
    );
  }

  private markRecovered(input: {
    discoveryId: string;
    contentHash: string;
    runId: string;
    seriesId: string;
    assetId: string;
  }) {
    const timestamp = now();
    const result = this.db
      .prepare(
        `UPDATE codex_image_discoveries SET
      imported_series_id = ?, imported_asset_id = ?, imported_output_id = NULL,
      imported_at = ?, updated_at = ?
      WHERE id = ? AND content_hash = ? AND missing_at IS NULL`,
      )
      .run(input.seriesId, input.assetId, timestamp, timestamp, input.discoveryId, input.contentHash);
    if (!result.changes) throw new Error('Discovered Codex image changed or is no longer available');
    this.recordEvent(
      input.discoveryId,
      'IMPORTED',
      {
        mode: 'GENERATION_RECOVERY',
        runId: input.runId,
        seriesId: input.seriesId,
        assetId: input.assetId,
        contentHash: input.contentHash,
      },
      timestamp,
    );
  }

  private recordEvent(
    discoveryId: string,
    eventKind: 'DISCOVERED' | 'UPDATED' | 'MISSING' | 'RESTORED' | 'IMPORTED',
    payload: JsonMap,
    createdAt: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO codex_image_discovery_events(
      id, discovery_id, event_kind, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), discoveryId, eventKind, JSON.stringify(payload), createdAt);
  }

  private recoveryTargets(threadIds: readonly string[]) {
    const uniqueThreadIds = [...new Set(threadIds)];
    if (!uniqueThreadIds.length) return new Map<string, CodexImageRecoveryTarget>();
    const placeholders = uniqueThreadIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT binding.thread_id, run.id AS run_id, version.series_id,
          version.id AS version_id, version.version_no,
          series.title AS creation_title, series.title_locale AS creation_title_locale,
          version.user_intent, version.final_prompt, version.source_image_id AS source_asset_id,
          run.model_key, run.created_at
        FROM extension_thread_bindings binding
        JOIN generation_runs run ON binding.scope_id = ('generation:' || run.id)
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        JOIN prompt_series series ON series.id = version.series_id
        WHERE binding.extension_id = ? AND binding.scope_kind = 'SYSTEM'
          AND binding.thread_id IN (${placeholders})
          AND run.model_key = ? AND run.result_asset_id IS NULL
          AND run.status IN ('FAILED', 'INTERRUPTED', 'CANCELLED')
          AND series.deleted_at IS NULL
        ORDER BY run.created_at DESC, run.id DESC`,
      )
      .all(CODEX_APP_SERVER_EXTENSION_ID, ...uniqueThreadIds, CODEX_APP_SERVER_IMAGE_MODEL_KEY) as RecoveryTargetRow[];
    const targets = new Map<string, CodexImageRecoveryTarget>();
    for (const row of rows) {
      if (targets.has(row.thread_id)) continue;
      targets.set(row.thread_id, {
        runId: row.run_id,
        seriesId: row.series_id,
        versionId: row.version_id,
        versionNo: Number(row.version_no),
        creationTitle: row.creation_title,
        creationTitleLocale: row.creation_title_locale === 'en' ? 'en' : 'zh',
        userIntent: row.user_intent,
        finalPrompt: row.final_prompt,
        sourceAssetId: row.source_asset_id,
        modelKey: row.model_key,
        createdAt: row.created_at,
      });
    }
    return targets;
  }

  private map(row: DiscoveryRow, recoveryTarget: CodexImageRecoveryTarget | null): CodexImageDiscoveryRecord {
    return {
      id: row.id,
      contentHash: row.content_hash ?? '',
      threadId: row.thread_id,
      threadName: row.thread_name,
      relativePath: row.relative_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      fileCreatedAt: row.file_created_at,
      fileModifiedAt: row.file_modified_at,
      importedSeriesId: row.imported_series_id,
      importedAssetId: row.imported_asset_id,
      importedOutputId: row.imported_output_id,
      importedAt: row.imported_at,
      discoveredAt: row.discovered_at,
      updatedAt: row.updated_at,
      missingAt: row.missing_at,
      inLibrary: Boolean(row.library_asset_id),
      libraryAssetId: row.library_asset_id ?? null,
      recoveryTarget,
    };
  }
}
