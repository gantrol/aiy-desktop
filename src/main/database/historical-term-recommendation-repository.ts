import { ulid } from 'ulid';
import type {
  CreatorAgentScope,
  HistoricalTermRecommendationBasis,
  HistoricalTermRecommendationCreateInput,
  HistoricalTermRecommendationItemDto,
  HistoricalTermRecommendationListInput,
  HistoricalTermRecommendationRunDto,
  Locale,
  PromptCommonInputDto,
} from '@/shared/contracts';
import { normalizeSearchText, searchTokenFrequencies, searchTokens } from '@/main/database/search-tokenizer';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { parsePromptCommonInput } from '@/main/database/snapshot-content';

interface HistorySourceRow extends JsonMap {
  prompt_version_id: string;
}

interface TermCatalogRow extends JsonMap {
  term_id: string;
}

interface TermCatalogItem {
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: string;
  localizations: Array<{ locale: string; title: string }>;
  aliases: string[];
  positive: string;
  tokens: Set<string>;
}

interface CandidateAccumulator {
  term: TermCatalogItem;
  similarScore: number;
  cooccurrenceScore: number;
  lexicalScore: number;
  similarPromptIds: Set<string>;
  cooccurrencePromptIds: Set<string>;
  lastUsedAt: string | null;
}

const PROMPT_HISTORY_INDEX_VERSION = 1;

function parseObject(value: unknown): JsonMap {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function safeStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sourceScope(row: JsonMap): CreatorAgentScope | null {
  const kind = text(row.scope_kind);
  const id = text(row.scope_id);
  return (kind === 'DRAFT' || kind === 'SERIES') && id ? { kind, id } : null;
}

function runDto(row: JsonMap): HistoricalTermRecommendationRunDto {
  const input = parseObject(row.input_snapshot_json);
  const result = parseObject(row.result_json);
  return {
    id: text(row.id),
    scope: sourceScope(row),
    status: 'READY',
    inputSnapshot: {
      prompt: text(input.prompt),
      selectedTermIds: safeStrings(input.selectedTermIds),
      candidateTermIds: safeStrings(input.candidateTermIds),
    },
    recommendations: Array.isArray(result.recommendations)
      ? (result.recommendations as HistoricalTermRecommendationItemDto[])
      : [],
    indexedPromptCount: Number(row.indexed_prompt_count) || 0,
    createdAt: text(row.created_at),
  };
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => '?').join(', ');
}

function sourceUses(common: PromptCommonInputDto) {
  const uses = new Map<string, 'DIRECT_TERM' | 'RECIPE_TERM'>();
  for (const value of common.directTerms) {
    if (value.termId) uses.set(value.termId, 'DIRECT_TERM');
  }
  for (const recipe of common.recipes) {
    for (const value of recipe.terms) {
      if (value.termId && !uses.has(value.termId)) uses.set(value.termId, 'RECIPE_TERM');
    }
  }
  return uses;
}

function localized(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en;
}

function recencyWeight(timestamp: string) {
  const age = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(age) || age <= 0) return 1;
  const ageInDays = age / 86_400_000;
  return 0.55 + 0.45 * Math.exp(-ageInDays / 240);
}

export class HistoricalTermRecommendationRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  list(input: HistoricalTermRecommendationListInput) {
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    const rows = input.scope
      ? (this.db
          .prepare(
            `SELECT * FROM historical_term_recommendation_runs
          WHERE scope_kind = ? AND scope_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(input.scope.kind, input.scope.id, limit) as JsonMap[])
      : (this.db
          .prepare(
            `SELECT * FROM historical_term_recommendation_runs
          WHERE scope_kind IS NULL AND scope_id IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(limit) as JsonMap[]);
    return rows.map(runDto);
  }

  create(input: HistoricalTermRecommendationCreateInput) {
    const selectedTermIds = [...new Set(input.selectedTermIds.filter(Boolean))].slice(0, 1_000);
    const candidateTermIds = [...new Set(input.candidateTermIds.filter(Boolean))].slice(0, 5_000);
    const prompt = input.prompt.trim().slice(0, 30_000);
    const indexedPromptCount = this.synchronizeIndex();
    const recommendations = this.recommend(prompt, selectedTermIds, candidateTermIds, input.locale, input.limit ?? 8);
    const id = ulid();
    const createdAt = now();
    const inputSnapshot = { prompt, selectedTermIds, candidateTermIds };
    const result = { recommendations };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO historical_term_recommendation_runs (
        id, scope_kind, scope_id, input_snapshot_json, result_json, indexed_prompt_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.scope?.kind ?? null,
          input.scope?.id ?? null,
          JSON.stringify(inputSnapshot),
          JSON.stringify(result),
          indexedPromptCount,
          createdAt,
        );
      this.storage.recordChange('HISTORICAL_TERM_RECOMMENDATION_RUN', id, 'CREATE', {
        scope: input.scope,
        indexedPromptCount,
        recommendationCount: recommendations.length,
        selectedTermCount: selectedTermIds.length,
      });
    })();
    return runDto(this.db.prepare('SELECT * FROM historical_term_recommendation_runs WHERE id = ?').get(id) as JsonMap);
  }

  private synchronizeIndex() {
    const sources = this.db
      .prepare(
        `SELECT version.id AS prompt_version_id,
        version.user_intent, version.content_hash, version.created_at, snapshot.common_input_json
      FROM prompt_versions version
      JOIN prompt_series series ON series.id = version.series_id
      JOIN prompt_input_snapshots snapshot ON snapshot.prompt_version_id = version.id
      WHERE series.deleted_at IS NULL`,
      )
      .all() as HistorySourceRow[];
    const activeIds = new Set(sources.map((source) => text(source.prompt_version_id)));
    const indexedRows = this.db
      .prepare('SELECT prompt_version_id, content_hash FROM prompt_history_documents')
      .all() as JsonMap[];
    const indexedHashes = new Map(indexedRows.map((row) => [text(row.prompt_version_id), text(row.content_hash)]));
    const validTermIds = new Set(
      (this.db.prepare('SELECT id FROM terms').all() as JsonMap[]).map((row) => text(row.id)),
    );

    this.db.transaction(() => {
      for (const indexedId of indexedHashes.keys()) {
        if (!activeIds.has(indexedId)) {
          this.db.prepare('DELETE FROM prompt_history_documents WHERE prompt_version_id = ?').run(indexedId);
        }
      }
      const insertDocument = this.db.prepare(`INSERT INTO prompt_history_documents (
        prompt_version_id, user_prompt, content_hash, token_count, source_created_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      const insertToken = this.db.prepare(`INSERT INTO prompt_history_tokens (
        prompt_version_id, token, term_frequency
      ) VALUES (?, ?, ?)`);
      const insertUse = this.db.prepare(`INSERT INTO prompt_history_term_uses (
        prompt_version_id, term_id, source_kind
      ) VALUES (?, ?, ?)`);
      for (const source of sources) {
        const promptVersionId = text(source.prompt_version_id);
        const contentHash = `v${PROMPT_HISTORY_INDEX_VERSION}:${text(source.content_hash)}`;
        if (indexedHashes.get(promptVersionId) === contentHash) continue;
        this.db.prepare('DELETE FROM prompt_history_documents WHERE prompt_version_id = ?').run(promptVersionId);
        const common = parsePromptCommonInput(source.common_input_json);
        const userPrompt = common.userInstruction;
        const frequencies = searchTokenFrequencies(userPrompt);
        const tokenCount = [...frequencies.values()].reduce((total, count) => total + count, 0);
        const indexedAt = now();
        insertDocument.run(promptVersionId, userPrompt, contentHash, tokenCount, text(source.created_at), indexedAt);
        for (const [token, frequency] of frequencies) insertToken.run(promptVersionId, token, frequency);
        const uses = sourceUses(common);
        for (const [termId, sourceKind] of uses) {
          if (validTermIds.has(termId)) insertUse.run(promptVersionId, termId, sourceKind);
        }
      }
    })();
    return (
      Number((this.db.prepare('SELECT count(*) AS count FROM prompt_history_documents').get() as JsonMap).count) || 0
    );
  }

  private recommend(
    prompt: string,
    selectedTermIds: string[],
    candidateTermIds: string[],
    locale: Locale,
    requestedLimit: number,
  ) {
    const limit = Math.max(1, Math.min(12, requestedLimit));
    const excluded = new Set(selectedTermIds);
    const allowed = new Set(candidateTermIds);
    const catalog = this.termCatalog().filter((term) => allowed.has(term.termId));
    const catalogById = new Map(catalog.map((term) => [term.termId, term]));
    const candidates = new Map<string, CandidateAccumulator>();
    const ensureCandidate = (termId: string) => {
      if (excluded.has(termId)) return null;
      const term = catalogById.get(termId);
      if (!term) return null;
      let candidate = candidates.get(termId);
      if (!candidate) {
        candidate = {
          term,
          similarScore: 0,
          cooccurrenceScore: 0,
          lexicalScore: 0,
          similarPromptIds: new Set(),
          cooccurrencePromptIds: new Set(),
          lastUsedAt: null,
        };
        candidates.set(termId, candidate);
      }
      return candidate;
    };

    const similarDocuments = this.similarDocuments(prompt);
    if (similarDocuments.length) {
      const ids = similarDocuments.map((document) => document.promptVersionId);
      const similarityById = new Map(similarDocuments.map((document) => [document.promptVersionId, document.score]));
      const rows = this.db
        .prepare(
          `SELECT usage.prompt_version_id, usage.term_id, usage.source_kind,
          document.source_created_at FROM prompt_history_term_uses usage
        JOIN prompt_history_documents document ON document.prompt_version_id = usage.prompt_version_id
        WHERE usage.prompt_version_id IN (${placeholders(ids)})`,
        )
        .all(...ids) as JsonMap[];
      for (const row of rows) {
        const candidate = ensureCandidate(text(row.term_id));
        if (!candidate) continue;
        const promptVersionId = text(row.prompt_version_id);
        const usedAt = text(row.source_created_at);
        const sourceWeight = text(row.source_kind) === 'DIRECT_TERM' ? 1 : 0.86;
        candidate.similarScore += (similarityById.get(promptVersionId) ?? 0) * sourceWeight * recencyWeight(usedAt);
        candidate.similarPromptIds.add(promptVersionId);
        if (!candidate.lastUsedAt || usedAt > candidate.lastUsedAt) candidate.lastUsedAt = usedAt;
      }
    }

    const cooccurringDocuments = this.cooccurringDocuments(selectedTermIds);
    if (cooccurringDocuments.length) {
      const ids = cooccurringDocuments.map((document) => document.promptVersionId);
      const selectedRatioById = new Map(
        cooccurringDocuments.map((document) => [document.promptVersionId, document.selectedRatio]),
      );
      const rows = this.db
        .prepare(
          `SELECT usage.prompt_version_id, usage.term_id, document.source_created_at
        FROM prompt_history_term_uses usage
        JOIN prompt_history_documents document ON document.prompt_version_id = usage.prompt_version_id
        WHERE usage.prompt_version_id IN (${placeholders(ids)})`,
        )
        .all(...ids) as JsonMap[];
      for (const row of rows) {
        const candidate = ensureCandidate(text(row.term_id));
        if (!candidate) continue;
        const promptVersionId = text(row.prompt_version_id);
        const usedAt = text(row.source_created_at);
        candidate.cooccurrenceScore += (selectedRatioById.get(promptVersionId) ?? 0) * recencyWeight(usedAt);
        candidate.cooccurrencePromptIds.add(promptVersionId);
        if (!candidate.lastUsedAt || usedAt > candidate.lastUsedAt) candidate.lastUsedAt = usedAt;
      }
    }

    const promptText = normalizeSearchText(prompt);
    const promptTokens = searchTokens(prompt);
    for (const term of catalog) {
      if (excluded.has(term.termId)) continue;
      const phrases = [term.title, ...term.localizations.map((item) => item.title), ...term.aliases]
        .map(normalizeSearchText)
        .filter((value) => value.length >= 2);
      const exact = Boolean(promptText) && phrases.some((phrase) => promptText.includes(phrase));
      const overlap = term.tokens.size
        ? [...term.tokens].filter((token) => promptTokens.has(token)).length / term.tokens.size
        : 0;
      const lexicalScore = exact ? 1 : overlap >= 0.5 ? Math.min(0.9, overlap) : 0;
      if (!lexicalScore) continue;
      const candidate = ensureCandidate(term.termId);
      if (candidate) candidate.lexicalScore = lexicalScore;
    }

    const maxSimilar = Math.max(0, ...[...candidates.values()].map((candidate) => candidate.similarScore));
    const maxCooccurrence = Math.max(0, ...[...candidates.values()].map((candidate) => candidate.cooccurrenceScore));
    return [...candidates.values()]
      .map((candidate) => {
        const similar = maxSimilar ? candidate.similarScore / maxSimilar : 0;
        const cooccurrence = maxCooccurrence ? candidate.cooccurrenceScore / maxCooccurrence : 0;
        const score = 0.55 * similar + 0.3 * cooccurrence + 0.15 * candidate.lexicalScore;
        const bases: HistoricalTermRecommendationBasis[] = [];
        if (candidate.similarPromptIds.size) bases.push('SIMILAR_PROMPT');
        if (candidate.cooccurrencePromptIds.size) bases.push('TERM_COOCCURRENCE');
        if (candidate.lexicalScore) bases.push('PROMPT_MATCH');
        return {
          candidate,
          score,
          dto: {
            termId: candidate.term.termId,
            termRevisionId: candidate.term.termRevisionId,
            title: candidate.term.title,
            titleLocale: candidate.term.titleLocale,
            localizations: candidate.term.localizations,
            score: Number(score.toFixed(3)),
            reason: this.reason(
              locale,
              candidate.similarPromptIds.size,
              candidate.cooccurrencePromptIds.size,
              candidate.lexicalScore > 0,
            ),
            bases,
            similarPromptCount: candidate.similarPromptIds.size,
            cooccurrenceCount: candidate.cooccurrencePromptIds.size,
            lastUsedAt: candidate.lastUsedAt,
          } satisfies HistoricalTermRecommendationItemDto,
        };
      })
      .filter((item) => item.score > 0.04)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.dto.similarPromptCount - left.dto.similarPromptCount ||
          right.dto.cooccurrenceCount - left.dto.cooccurrenceCount ||
          left.dto.termId.localeCompare(right.dto.termId),
      )
      .slice(0, limit)
      .map((item) => item.dto);
  }

  private similarDocuments(prompt: string) {
    const queryFrequencies = [...searchTokenFrequencies(prompt)].slice(0, 160);
    if (!queryFrequencies.length) return [];
    const queryTokens = queryFrequencies.map(([token]) => token);
    const rows = this.db
      .prepare(
        `SELECT token.token, token.prompt_version_id, token.term_frequency,
        document.token_count, document.source_created_at
      FROM prompt_history_tokens token
      JOIN prompt_history_documents document ON document.prompt_version_id = token.prompt_version_id
      WHERE token.token IN (${placeholders(queryTokens)})`,
      )
      .all(...queryTokens) as JsonMap[];
    if (!rows.length) return [];
    const totalDocuments =
      Number((this.db.prepare('SELECT count(*) AS count FROM prompt_history_documents').get() as JsonMap).count) || 1;
    const averageLength =
      Number(
        (this.db.prepare('SELECT avg(token_count) AS average FROM prompt_history_documents').get() as JsonMap).average,
      ) || 1;
    const documentsByToken = new Map<string, Set<string>>();
    for (const row of rows) {
      const token = text(row.token);
      const documents = documentsByToken.get(token) ?? new Set<string>();
      documents.add(text(row.prompt_version_id));
      documentsByToken.set(token, documents);
    }
    const queryFrequencyByToken = new Map(queryFrequencies);
    const scores = new Map<string, { score: number; sourceCreatedAt: string }>();
    for (const row of rows) {
      const token = text(row.token);
      const promptVersionId = text(row.prompt_version_id);
      const termFrequency = Number(row.term_frequency) || 0;
      const documentLength = Number(row.token_count) || 0;
      const documentFrequency = documentsByToken.get(token)?.size ?? 1;
      const inverseDocumentFrequency = Math.log(
        1 + (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const denominator = termFrequency + 1.2 * (0.25 + (0.75 * documentLength) / averageLength);
      const queryWeight = 1 + Math.log(queryFrequencyByToken.get(token) ?? 1);
      const increment = inverseDocumentFrequency * ((termFrequency * 2.2) / denominator) * queryWeight;
      const current = scores.get(promptVersionId) ?? { score: 0, sourceCreatedAt: text(row.source_created_at) };
      current.score += increment;
      scores.set(promptVersionId, current);
    }
    const maximum = Math.max(...[...scores.values()].map((item) => item.score), 1);
    return [...scores]
      .map(([promptVersionId, value]) => ({
        promptVersionId,
        score: value.score / maximum,
        sourceCreatedAt: value.sourceCreatedAt,
      }))
      .sort((left, right) => right.score - left.score || right.sourceCreatedAt.localeCompare(left.sourceCreatedAt))
      .slice(0, 40);
  }

  private cooccurringDocuments(selectedTermIds: string[]) {
    if (!selectedTermIds.length) return [];
    const selected = selectedTermIds.slice(0, 1_000);
    const rows = this.db
      .prepare(
        `SELECT usage.prompt_version_id,
        count(DISTINCT usage.term_id) AS selected_count, document.source_created_at
      FROM prompt_history_term_uses usage
      JOIN prompt_history_documents document ON document.prompt_version_id = usage.prompt_version_id
      WHERE usage.term_id IN (${placeholders(selected)})
      GROUP BY usage.prompt_version_id
      ORDER BY document.source_created_at DESC
      LIMIT 500`,
      )
      .all(...selected) as JsonMap[];
    return rows.map((row) => ({
      promptVersionId: text(row.prompt_version_id),
      selectedRatio: Math.min(1, (Number(row.selected_count) || 0) / selected.length),
    }));
  }

  private termCatalog() {
    const rows = this.db
      .prepare(
        `SELECT term.id AS term_id, revision.id AS term_revision_id,
        revision.title, revision.title_locale,
        COALESCE((SELECT expression.positive_expression FROM term_expressions expression
          WHERE expression.term_revision_id = revision.id
          ORDER BY CASE WHEN expression.model_key = 'gpt-image-2' THEN 0 ELSE 1 END,
            CASE WHEN expression.locale = 'en' THEN 0 ELSE 1 END, expression.id DESC LIMIT 1), '') AS positive_expression,
        COALESCE((SELECT group_concat(alias.value, char(31)) FROM term_aliases alias
          WHERE alias.term_revision_id = revision.id), '') AS aliases
      FROM terms term
      JOIN term_revisions revision ON revision.id = term.current_revision_id
      WHERE term.archived_at IS NULL`,
      )
      .all() as TermCatalogRow[];
    const revisionIds = rows.map((row) => text(row.term_revision_id));
    const localizationByRevision = new Map<string, Array<{ locale: string; title: string }>>();
    if (revisionIds.length) {
      const localizationRows = this.db
        .prepare(
          `SELECT term_revision_id, locale, title FROM term_localizations
          WHERE term_revision_id IN (${placeholders(revisionIds)})
          ORDER BY term_revision_id, locale, id`,
        )
        .all(...revisionIds) as JsonMap[];
      for (const localization of localizationRows) {
        const revisionId = text(localization.term_revision_id);
        const items = localizationByRevision.get(revisionId) ?? [];
        items.push({ locale: text(localization.locale), title: text(localization.title) });
        localizationByRevision.set(revisionId, items);
      }
    }
    return rows.map((row) => {
      const title = text(row.title);
      const titleLocale = text(row.title_locale);
      const localizations = localizationByRevision.get(text(row.term_revision_id)) ?? [];
      const aliases = text(row.aliases).split(String.fromCodePoint(31)).filter(Boolean);
      const positive = text(row.positive_expression);
      return {
        termId: text(row.term_id),
        termRevisionId: text(row.term_revision_id),
        title,
        titleLocale,
        localizations,
        aliases,
        positive,
        tokens: searchTokens([title, ...localizations.map((item) => item.title), ...aliases, positive].join(' ')),
      };
    });
  }

  private reason(locale: Locale, similarPromptCount: number, cooccurrenceCount: number, lexical: boolean) {
    if (similarPromptCount && cooccurrenceCount) {
      return localized(
        locale,
        `出现在 ${similarPromptCount} 条相似历史 Prompt 中，并与已选词条共同使用 ${cooccurrenceCount} 次`,
        `Used in ${similarPromptCount} similar prompts and co-occurred with selected terms ${cooccurrenceCount} times`,
      );
    }
    if (similarPromptCount) {
      return localized(
        locale,
        `出现在 ${similarPromptCount} 条相似历史 Prompt 中`,
        `Used in ${similarPromptCount} similar historical prompts`,
      );
    }
    if (cooccurrenceCount) {
      return localized(
        locale,
        `与已选词条共同使用 ${cooccurrenceCount} 次`,
        `Co-occurred with selected terms ${cooccurrenceCount} times`,
      );
    }
    return lexical
      ? localized(locale, '与当前 Prompt 的表达匹配', 'Matches the current Prompt')
      : localized(locale, '来自历史 Prompt', 'From Prompt history');
  }
}
