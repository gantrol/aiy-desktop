import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, strings, text } from '@/main/database/core/values';

const maps = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object') : [];

export class ImportRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  stageImport(fileName: string, rows: JsonMap[]) {
    const batchId = ulid();
    let valid = 0;
    let duplicate = 0;
    let invalid = 0;
    const samples: Array<{ title: string; titleLocale: string; state: string }> = [];
    const insertBatch = this.db.prepare("INSERT INTO import_batches VALUES (?, ?, 'STAGED', ?, NULL)");
    const findTerm = this.db.prepare('SELECT 1 FROM terms WHERE stable_key = ?');
    const insertItem = this.db.prepare('INSERT INTO import_items VALUES (?, ?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      insertBatch.run(batchId, fileName, now());
      rows.forEach((row, index) => {
        const title = text(row.title).trim();
        const titleLocale = text(row.titleLocale).trim().toLowerCase();
        const stableKey =
          text(row.stableKey).trim() ||
          `import.${createHash('sha1').update(`${titleLocale}|${title}`).digest('hex').slice(0, 16)}`;
        let outcome = 'VALID';
        let message = '';
        if (!title || !titleLocale) {
          outcome = 'INVALID';
          message = 'missing title or title language';
          invalid += 1;
        } else if (findTerm.get(stableKey)) {
          outcome = 'DUPLICATE';
          message = 'stable key exists';
          duplicate += 1;
        } else valid += 1;
        const normalized = {
          stableKey,
          title,
          titleLocale,
          definition: text(row.definition),
          aliases: strings(row.aliases),
          localizations: maps(row.localizations),
          classificationKeys: strings(row.classificationKeys),
          primaryDirectoryClassificationKey: text(row.primaryDirectoryClassificationKey),
          expressions: maps(row.expressions),
        };
        insertItem.run(ulid(), batchId, index + 1, JSON.stringify(normalized), outcome, message);
        if (samples.length < 5) samples.push({ title, titleLocale, state: outcome });
      });
    })();
    return { batchId, fileName, rows: rows.length, valid, duplicate, invalid, samples };
  }

  commitImport(batchId: string) {
    const batch = this.db.prepare("SELECT * FROM import_batches WHERE id = ? AND status = 'STAGED'").get(batchId);
    if (!batch) throw new Error('Import batch is no longer available');
    const rows = this.db
      .prepare("SELECT * FROM import_items WHERE batch_id = ? AND outcome = 'VALID' ORDER BY row_no")
      .all(batchId) as JsonMap[];
    let imported = 0;
    let skipped = 0;
    const findTerm = this.db.prepare('SELECT 1 FROM terms WHERE stable_key = ?');
    const insertTerm = this.db.prepare(
      `INSERT INTO terms(id, stable_key, current_revision_id, editorial_state, archived_at)
      VALUES (?, ?, ?, 'DRAFT', NULL)`,
    );
    const insertRevision = this.db.prepare(
      `INSERT INTO term_revisions
      (id, term_id, revision_no, title, title_locale, definition, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)`,
    );
    const insertLocalization = this.db.prepare('INSERT INTO term_localizations VALUES (?, ?, ?, ?, ?)');
    const insertAlias = this.db.prepare('INSERT INTO term_aliases VALUES (?, ?, ?, ?, ?)');
    const insertExpression = this.db.prepare(
      `INSERT INTO term_expressions
      (id, term_revision_id, context_profile_revision_id, model_key, locale,
        positive_expression, negative_expression)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFacet = this.db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
    const insertClassification = this.db.prepare(
      'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, ?)',
    );
    const finishBatch = this.db.prepare(
      "UPDATE import_batches SET status = 'COMMITTED', committed_at = ? WHERE id = ?",
    );
    this.db.transaction(() => {
      for (const item of rows) {
        const row = JSON.parse(text(item.normalized_json)) as JsonMap;
        if (findTerm.get(row.stableKey)) {
          skipped += 1;
          continue;
        }
        const termId = ulid();
        const revisionId = ulid();
        const classificationKeys = [...new Set(strings(row.classificationKeys))];
        const classifications = classificationKeys.map((stableKey) => {
          const classification = this.db
            .prepare('SELECT * FROM term_categories WHERE stable_key = ?')
            .get(stableKey) as JsonMap | undefined;
          if (!classification) throw new Error(`Unknown dictionary classification: ${stableKey}`);
          return classification;
        });
        const primaryKey = text(row.primaryDirectoryClassificationKey);
        if (classifications.length > 0 && !primaryKey) {
          throw new Error(`Imported term needs a primary directory classification: ${text(row.stableKey)}`);
        }
        if (primaryKey && !classificationKeys.includes(primaryKey)) {
          throw new Error(`Primary directory classification must be selected: ${text(row.stableKey)}`);
        }
        const primaryClassification = primaryKey ? classifications[classificationKeys.indexOf(primaryKey)] : undefined;
        insertTerm.run(termId, row.stableKey, revisionId);
        insertRevision.run(revisionId, termId, row.title, row.titleLocale, row.definition, now());
        for (const value of strings(row.aliases)) {
          insertAlias.run(ulid(), revisionId, row.titleLocale, value, value.toLowerCase());
        }
        for (const localization of maps(row.localizations)) {
          insertLocalization.run(
            ulid(),
            revisionId,
            localization.locale,
            localization.title,
            localization.definition ?? '',
          );
          for (const value of strings(localization.aliases)) {
            insertAlias.run(ulid(), revisionId, localization.locale, value, value.toLowerCase());
          }
        }
        const contextProfileRevisions = new Map<string, string>();
        for (const expression of maps(row.expressions)) {
          const contextKey = text(expression.contextKey).trim().toLocaleLowerCase();
          if (!contextKey) throw new Error(`Imported expression needs a context: ${text(row.stableKey)}`);
          let contextProfileRevisionId = contextProfileRevisions.get(contextKey);
          if (!contextProfileRevisionId) {
            const profileId = ulid();
            this.db
              .prepare(
                `INSERT INTO term_context_profiles(id, term_id, stable_key, created_at)
                VALUES (?, ?, ?, ?)`,
              )
              .run(profileId, termId, contextKey, now());
            contextProfileRevisionId = ulid();
            this.db
              .prepare(
                `INSERT INTO term_context_profile_revisions(
                  id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
                ) VALUES (?, ?, ?, '', '', ?)`,
              )
              .run(contextProfileRevisionId, profileId, revisionId, now());
            contextProfileRevisions.set(contextKey, contextProfileRevisionId);
          }
          insertExpression.run(
            ulid(),
            revisionId,
            contextProfileRevisionId,
            expression.modelKey,
            expression.locale,
            expression.positive ?? '',
            expression.negative ?? '',
          );
        }
        const categoryValueIds = [
          ...new Set(
            classifications.flatMap((classification) => [
              text(classification.primary_facet_value_id),
              text(classification.secondary_facet_value_id),
            ]),
          ),
        ];
        for (const facetValueId of categoryValueIds.filter(Boolean)) {
          insertFacet.run(ulid(), revisionId, facetValueId);
        }
        for (const [sortOrder, classification] of classifications.entries()) {
          insertClassification.run(ulid(), revisionId, classification.id, sortOrder);
        }
        this.db
          .prepare(
            `UPDATE term_directory_placements
            SET primary_category_id = ?, domain_facet_value_id = ?, item_type_facet_value_id = ?, updated_at = ?
            WHERE term_id = ?`,
          )
          .run(
            primaryClassification?.id ?? null,
            primaryClassification?.primary_facet_value_id ?? null,
            primaryClassification?.secondary_facet_value_id ?? null,
            now(),
            termId,
          );
        this.storage.recordChange('TERM', termId, 'IMPORT_DRAFT', { batchId });
        imported += 1;
      }
      finishBatch.run(now(), batchId);
    })();
    return { imported, skipped };
  }
}
