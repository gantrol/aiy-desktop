import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { ProviderReturnedDescriptionDto, ProviderReturnedDescriptionInput } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

function normalizedInput(input: ProviderReturnedDescriptionInput) {
  const fieldName = input.fieldName.trim();
  if (!fieldName) throw new Error('Provider description field name is required');
  if (fieldName.length > 200) throw new Error('Provider description field name is too long');
  if (input.rawValue.length > 100_000) throw new Error('Provider description is too long');
  const scopeKind = input.scopeKind ?? 'RUN';
  const outputOrdinal = scopeKind === 'OUTPUT' ? (input.outputOrdinal ?? 0) : -1;
  if (!Number.isInteger(outputOrdinal) || outputOrdinal < (scopeKind === 'OUTPUT' ? 0 : -1)) {
    throw new Error('Provider description output ordinal is invalid');
  }
  return {
    fieldName,
    rawValue: input.rawValue,
    interpretation: input.interpretation?.trim() || null,
    scopeKind,
    outputOrdinal,
  };
}

function contentHash(value: ReturnType<typeof normalizedInput>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ProviderDescriptionRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  record(runId: string, inputs: readonly ProviderReturnedDescriptionInput[]) {
    if (!inputs.length) return [];
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM generation_runs WHERE id = ?').get(runId)) {
        throw new Error(`Generation run not found: ${runId}`);
      }
      const receivedAt = now();
      for (const input of inputs) {
        const value = normalizedInput(input);
        const hash = contentHash(value);
        const existing = this.db
          .prepare(
            `SELECT 1 FROM provider_returned_descriptions
          WHERE generation_run_id = ? AND field_name = ? AND output_ordinal = ? AND content_hash = ?`,
          )
          .get(runId, value.fieldName, value.outputOrdinal, hash);
        if (existing) continue;
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO provider_returned_descriptions
          (id, generation_run_id, field_name, raw_value, interpretation, scope_kind,
           output_ordinal, content_hash, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            runId,
            value.fieldName,
            value.rawValue,
            value.interpretation,
            value.scopeKind,
            value.outputOrdinal,
            hash,
            receivedAt,
          );
        this.storage.recordChange('GENERATION_RUN', runId, 'RECORD_PROVIDER_DESCRIPTION', {
          providerDescriptionId: id,
          fieldName: value.fieldName,
          scopeKind: value.scopeKind,
          outputOrdinal: value.outputOrdinal,
        });
      }
      return this.list(runId);
    })();
  }

  list(runId: string): ProviderReturnedDescriptionDto[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM provider_returned_descriptions
      WHERE generation_run_id = ? ORDER BY received_at, id`,
        )
        .all(runId) as JsonMap[]
    ).map((row) => ({
      id: text(row.id),
      fieldName: text(row.field_name),
      rawValue: text(row.raw_value),
      interpretation: row.interpretation == null ? null : text(row.interpretation),
      scopeKind: text(row.scope_kind) as ProviderReturnedDescriptionDto['scopeKind'],
      outputOrdinal: Number(row.output_ordinal) < 0 ? null : Number(row.output_ordinal),
      contentHash: text(row.content_hash),
      receivedAt: text(row.received_at),
    }));
  }
}
