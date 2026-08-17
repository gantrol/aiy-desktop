import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  ContentLocale,
  DictionaryMaintenanceCandidateDto,
  DictionaryMaintenanceIssueCode,
  DictionaryMaintenanceIssueDto,
  DictionaryMaintenanceReportDto,
  DictionaryMaintenanceSeverity,
  DictionaryMaintenanceSummaryDto,
  Locale,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { normalizeSearchText } from '@/main/database/dictionary/search-tokenizer';
import { type JsonMap, now, text } from '@/main/database/core/values';

interface MaintenanceExpression {
  id: string;
  contextKey: string;
  modelKey: string;
  locale: ContentLocale;
  positive: string;
  negative: string;
}

interface MaintenanceLocalization {
  locale: ContentLocale;
  title: string;
  definition: string;
}

interface MaintenanceRow extends JsonMap {
  term_id: string;
  term_revision_id: string;
  title: string;
  title_locale: string;
  display_title: string;
  display_title_locale: string;
  definition: string;
  classification_ids_json: string;
  primary_directory_classification_id: string | null;
  expressions_json: string;
  localizations_json: string;
  citation_count: number;
  series_count: number;
}

interface ReportRow extends JsonMap {
  id: string;
  locale: Locale;
  source_hash: string;
  source_revision_count: number;
  summary_json: string;
  candidates_json: string;
  created_at: string;
}

const severityRank: Record<DictionaryMaintenanceSeverity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  INFO: 1,
};

// Bump this when the deterministic maintenance rules change.
const maintenanceRulesetVersion = 1;

const issueSeverity: Record<DictionaryMaintenanceIssueCode, DictionaryMaintenanceSeverity> = {
  MISSING_TITLE: 'CRITICAL',
  MISSING_TITLE_LOCALE: 'CRITICAL',
  MISSING_DEFINITION: 'CRITICAL',
  MISSING_CATEGORY: 'CRITICAL',
  MISSING_POSITIVE_EXPRESSION: 'CRITICAL',
  DUPLICATE_POSITIVE_EXPRESSION: 'WARNING',
  UNUSED_TERM: 'INFO',
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function localized(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en;
}

function numeric(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function expressions(row: MaintenanceRow) {
  return parseJson<MaintenanceExpression[]>(row.expressions_json, []);
}

export class DictionaryMaintenanceRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  create(locale: Locale): DictionaryMaintenanceReportDto {
    if (!this.hasStorage()) throw new Error('Dictionary maintenance report storage is unavailable');
    const snapshot = this.snapshot(locale);
    const id = ulid();
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO dictionary_maintenance_reports
        (id, locale, source_hash, source_revision_count, summary_json, candidates_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          locale,
          snapshot.sourceHash,
          snapshot.sourceRevisionCount,
          JSON.stringify(snapshot.summary),
          JSON.stringify(snapshot.candidates),
          timestamp,
        );
      this.storage.recordChange('DICTIONARY_MAINTENANCE_REPORT', id, 'CREATE', {
        sourceHash: snapshot.sourceHash,
        sourceRevisionCount: snapshot.sourceRevisionCount,
        summary: snapshot.summary,
      });
    })();
    return {
      id,
      locale,
      deterministic: true,
      isStale: false,
      createdAt: timestamp,
      ...snapshot,
    };
  }

  list(locale: Locale, limit = 8): DictionaryMaintenanceReportDto[] {
    if (!this.hasStorage()) return [];
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM dictionary_maintenance_reports
      WHERE locale = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(locale, safeLimit) as ReportRow[];
    if (!rows.length) return [];
    const currentHash = this.sourceHash(this.sourceRows(locale));
    return rows.map((row) => ({
      id: text(row.id),
      locale: text(row.locale) === 'zh' ? 'zh' : 'en',
      deterministic: true,
      sourceHash: text(row.source_hash),
      sourceRevisionCount: numeric(row.source_revision_count),
      isStale: text(row.source_hash) !== currentHash,
      summary: parseJson<DictionaryMaintenanceSummaryDto>(row.summary_json, this.emptySummary()),
      candidates: parseJson<DictionaryMaintenanceCandidateDto[]>(row.candidates_json, []),
      createdAt: text(row.created_at),
    }));
  }

  private snapshot(locale: Locale) {
    const rows = this.sourceRows(locale);
    const issuesByTerm = new Map<string, DictionaryMaintenanceIssueDto[]>();
    const issueCounts: Partial<Record<DictionaryMaintenanceIssueCode, number>> = {};
    const addIssue = (termId: string, issue: DictionaryMaintenanceIssueDto) => {
      const issues = issuesByTerm.get(termId) ?? [];
      issues.push(issue);
      issuesByTerm.set(termId, issues);
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    };
    const missingIssue = (
      row: MaintenanceRow,
      code: DictionaryMaintenanceIssueCode,
      field: string,
      reasonZh: string,
      reasonEn: string,
    ) =>
      addIssue(text(row.term_id), {
        code,
        field,
        before: '',
        expected: localized(locale, '补全后再核准词条', 'Complete it before approving the term'),
        reason: localized(locale, reasonZh, reasonEn),
        relatedTermIds: [],
      });

    const duplicateGroups = new Map<string, Array<{ row: MaintenanceRow; expression: MaintenanceExpression }>>();
    for (const row of rows) {
      const rowExpressions = expressions(row);
      for (const expression of rowExpressions) {
        const normalized = normalizeSearchText(expression.positive);
        if (normalized.length < 8) continue;
        const key = `${expression.contextKey.trim().toLocaleLowerCase()}\u0000${expression.modelKey.trim().toLocaleLowerCase()}\u0000${expression.locale.trim().toLocaleLowerCase()}\u0000${normalized}`;
        const group = duplicateGroups.get(key) ?? [];
        group.push({ row, expression });
        duplicateGroups.set(key, group);
      }

      if (!text(row.title).trim()) missingIssue(row, 'MISSING_TITLE', 'title', '缺少名称', 'Title is missing');
      if (!text(row.title_locale).trim())
        missingIssue(row, 'MISSING_TITLE_LOCALE', 'titleLocale', '缺少名称语言', 'Title locale is missing');
      if (!text(row.definition).trim())
        missingIssue(row, 'MISSING_DEFINITION', 'definition', '缺少定义', 'Definition is missing');
      const classificationIds = parseJson<string[]>(row.classification_ids_json, []);
      if (!classificationIds.length || !classificationIds.includes(text(row.primary_directory_classification_id))) {
        missingIssue(
          row,
          'MISSING_CATEGORY',
          'classificationIds',
          '尚未选择分类和主要目录',
          'Classification is missing',
        );
      }
      if (!rowExpressions.some((expression) => expression.positive.trim()))
        missingIssue(
          row,
          'MISSING_POSITIVE_EXPRESSION',
          'expressions',
          '缺少至少一条正向模型表达',
          'At least one positive model expression is required',
        );
      if (numeric(row.citation_count) === 0) {
        addIssue(text(row.term_id), {
          code: 'UNUSED_TERM',
          field: 'citations',
          before: '0',
          expected: localized(locale, '判断是否保留、试用或归档', 'Decide whether to keep, try, or archive it'),
          reason: localized(locale, '尚未被任何历史 Prompt 引用', 'No historical prompt cites this term'),
          relatedTermIds: [],
        });
      }
    }

    let duplicateExpressionGroupCount = 0;
    for (const group of duplicateGroups.values()) {
      const distinctTermIds = [...new Set(group.map(({ row }) => text(row.term_id)))];
      if (distinctTermIds.length < 2) continue;
      duplicateExpressionGroupCount += 1;
      for (const termId of distinctTermIds) {
        const current = group.find(({ row }) => text(row.term_id) === termId);
        if (!current) continue;
        addIssue(termId, {
          code: 'DUPLICATE_POSITIVE_EXPRESSION',
          field: 'expressions',
          before: current.expression.positive,
          expected: localized(locale, '比较语义后决定区分或合并', 'Compare semantics, then distinguish or merge'),
          reason: localized(
            locale,
            '相同模型和语言下有其他词条使用同一正向表达',
            'Another term uses the same positive expression for this model and locale',
          ),
          relatedTermIds: distinctTermIds.filter((relatedTermId) => relatedTermId !== termId),
        });
      }
    }

    const candidates = rows
      .flatMap((row) => {
        const issues = issuesByTerm.get(text(row.term_id)) ?? [];
        if (!issues.length) return [];
        const severity = issues.reduce<DictionaryMaintenanceSeverity>(
          (current, issue) =>
            severityRank[issueSeverity[issue.code]] > severityRank[current] ? issueSeverity[issue.code] : current,
          'INFO',
        );
        return [
          {
            id: `term:${text(row.term_id)}`,
            termId: text(row.term_id),
            termRevisionId: text(row.term_revision_id),
            title: text(row.display_title) || text(row.title),
            titleLocale: text(row.display_title_locale) || text(row.title_locale),
            severity,
            issues,
            citationCount: numeric(row.citation_count),
            distinctPromptSeries: numeric(row.series_count),
          } satisfies DictionaryMaintenanceCandidateDto,
        ];
      })
      .sort(
        (left, right) =>
          severityRank[right.severity] - severityRank[left.severity] ||
          right.issues.length - left.issues.length ||
          right.citationCount - left.citationCount ||
          left.title.localeCompare(right.title),
      );

    const isReady = (row: MaintenanceRow) =>
      Boolean(
        text(row.title).trim() &&
        text(row.title_locale).trim() &&
        text(row.definition).trim() &&
        parseJson<string[]>(row.classification_ids_json, []).includes(text(row.primary_directory_classification_id)) &&
        expressions(row).some((expression) => expression.positive.trim()),
      );
    const summary: DictionaryMaintenanceSummaryDto = {
      termCount: rows.length,
      readyTermCount: rows.filter(isReady).length,
      citedTermCount: rows.filter((row) => numeric(row.citation_count) > 0).length,
      uncitedTermCount: rows.filter((row) => numeric(row.citation_count) === 0).length,
      missingDefinitionCount: rows.filter((row) => !text(row.definition).trim()).length,
      missingCategoryCount: rows.filter(
        (row) =>
          !parseJson<string[]>(row.classification_ids_json, []).includes(text(row.primary_directory_classification_id)),
      ).length,
      missingPositiveExpressionCount: rows.filter(
        (row) => !expressions(row).some((expression) => expression.positive.trim()),
      ).length,
      duplicateExpressionGroupCount,
      candidateTermCount: candidates.length,
      issueCounts,
    };
    return {
      sourceHash: this.sourceHash(rows),
      sourceRevisionCount: rows.length,
      summary,
      candidates: candidates.slice(0, 250),
    };
  }

  private sourceHash(rows: MaintenanceRow[]) {
    const terms = rows.map((row) => ({
      termId: text(row.term_id),
      revisionId: text(row.term_revision_id),
      title: text(row.title),
      titleLocale: text(row.title_locale),
      definition: text(row.definition),
      classificationIds: parseJson<string[]>(row.classification_ids_json, []),
      primaryDirectoryClassificationId: text(row.primary_directory_classification_id),
      expressions: expressions(row),
      localizations: parseJson<MaintenanceLocalization[]>(row.localizations_json, []),
      citations: numeric(row.citation_count),
      series: numeric(row.series_count),
    }));
    return createHash('sha256').update(JSON.stringify({ maintenanceRulesetVersion, terms })).digest('hex');
  }

  private sourceRows(locale: Locale): MaintenanceRow[] {
    return this.db
      .prepare(
        `WITH citation_metrics AS (
        SELECT binding.term_id, COUNT(*) AS citation_count,
          COUNT(DISTINCT version.series_id) AS series_count
        FROM prompt_term_bindings binding
        JOIN prompt_versions version ON version.id = binding.prompt_version_id
        GROUP BY binding.term_id
      )
      SELECT term.id AS term_id, revision.id AS term_revision_id,
        revision.title, revision.title_locale, revision.definition,
        placement.primary_category_id AS primary_directory_classification_id,
        COALESCE((
          SELECT json_group_array(ordered.category_id)
          FROM (
            SELECT membership.category_id
            FROM term_revision_categories membership
            WHERE membership.term_revision_id = revision.id
            ORDER BY membership.sort_order, membership.category_id
          ) ordered
        ), '[]') AS classification_ids_json,
        COALESCE((
          SELECT localization.title FROM term_localizations localization
          WHERE localization.term_revision_id = revision.id AND localization.locale = ?
          ORDER BY localization.id LIMIT 1
        ), revision.title) AS display_title,
        CASE WHEN EXISTS (
          SELECT 1 FROM term_localizations localization
          WHERE localization.term_revision_id = revision.id AND localization.locale = ?
        ) THEN ? ELSE revision.title_locale END AS display_title_locale,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', ordered.id,
            'contextKey', ordered.context_key,
            'modelKey', ordered.model_key,
            'locale', ordered.locale,
            'positive', ordered.positive_expression,
            'negative', ordered.negative_expression
          ))
          FROM (
            SELECT expression.*, profile.stable_key AS context_key
            FROM term_expressions expression
            JOIN term_context_profile_revisions profile_revision
              ON profile_revision.id = expression.context_profile_revision_id
            JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
            WHERE expression.term_revision_id = revision.id
            ORDER BY expression.model_key, expression.locale, expression.id
          ) ordered
        ), '[]') AS expressions_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'locale', ordered.locale,
            'title', ordered.title,
            'definition', ordered.definition
          ))
          FROM (
            SELECT localization.* FROM term_localizations localization
            WHERE localization.term_revision_id = revision.id
            ORDER BY localization.locale, localization.id
          ) ordered
        ), '[]') AS localizations_json,
        COALESCE(citation.citation_count, 0) AS citation_count,
        COALESCE(citation.series_count, 0) AS series_count
      FROM terms term
      JOIN term_revisions revision ON revision.id = term.current_revision_id
      LEFT JOIN term_directory_placements placement ON placement.term_id = term.id
      LEFT JOIN citation_metrics citation ON citation.term_id = term.id
      WHERE term.archived_at IS NULL
      ORDER BY term.stable_key, term.id`,
      )
      .all(locale, locale, locale) as MaintenanceRow[];
  }

  private hasStorage() {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'dictionary_maintenance_reports'`,
        )
        .get(),
    );
  }

  private emptySummary(): DictionaryMaintenanceSummaryDto {
    return {
      termCount: 0,
      readyTermCount: 0,
      citedTermCount: 0,
      uncitedTermCount: 0,
      missingDefinitionCount: 0,
      missingCategoryCount: 0,
      missingPositiveExpressionCount: 0,
      duplicateExpressionGroupCount: 0,
      candidateTermCount: 0,
      issueCounts: {},
    };
  }
}
