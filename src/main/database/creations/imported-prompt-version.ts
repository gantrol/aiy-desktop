import { ulid } from 'ulid';
import type { PromptCommonInputDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import type { ExecutionSnapshotRepository } from '@/main/database/generation/execution-snapshot-repository';

/** Called inside the output import transaction, only for images that will be inserted. */
export function resolveImportedPromptVersion(
  storage: LibraryStorage,
  snapshots: ExecutionSnapshotRepository,
  seriesId: string,
  versionNo: number,
): string {
  if (!Number.isSafeInteger(versionNo) || versionNo < 1 || versionNo > 999999) {
    throw new Error('Invalid imported version number');
  }
  const db = storage.db;
  const existing = db
    .prepare('SELECT id FROM prompt_versions WHERE series_id = ? AND version_no = ?')
    .get(seriesId, versionNo) as JsonMap | undefined;
  if (existing) return text(existing.id);

  const promptInput: PromptCommonInputDto = {
    userInstruction: '',
    directTermPromptLocale: 'en',
    directTerms: [],
    recipes: [],
    directReferences: [],
    flatPrompt: '',
  };
  const versionId = ulid();
  db.prepare(
    `INSERT INTO prompt_versions
      (id, series_id, parent_version_id, version_no, user_intent, final_prompt, change_summary,
       content_hash, created_at, composition_mode, term_prompt_locale, origin_type, prompt_knowledge)
     VALUES (?, ?, NULL, ?, '', '', 'EXTERNAL_IMPORT', ?, ?, 'FLATTENED', 'en', 'EXTERNAL_IMPORT', 'UNKNOWN')`,
  ).run(versionId, seriesId, versionNo, snapshots.promptInputHash(promptInput), now());
  snapshots.freezePromptInput(versionId, promptInput);
  // Backfilling an older external revision must not move the current revision backwards.
  db.prepare(
    `UPDATE prompt_series SET current_version_id = ? WHERE id = ?
       AND (current_version_id IS NULL OR ? > COALESCE(
         (SELECT version_no FROM prompt_versions WHERE id = prompt_series.current_version_id), 0))`,
  ).run(versionId, seriesId, versionNo);
  storage.recordChange('PROMPT_VERSION', versionId, 'CREATE', {
    seriesId,
    versionNo,
    originType: 'EXTERNAL_IMPORT',
    promptKnowledge: 'UNKNOWN',
  });
  return versionId;
}
