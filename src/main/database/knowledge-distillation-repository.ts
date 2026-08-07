import { ulid } from 'ulid';
import {
  DEFAULT_TERM_CONTEXT_KEY,
  type ContentLocale,
  type KnowledgeDistillationAcceptInput,
  type KnowledgeDistillationAcceptResult,
  type KnowledgeDistillationCreateInput,
  type KnowledgeDistillationMatchSource,
  type KnowledgeDistillationProposalDto,
  type KnowledgeDistillationTermCandidateDto,
  type KnowledgeDistillationTermMatchDto,
  type LocalizedTitleDto,
  type Locale,
  type PromptCommonInputDto,
} from '@/shared/contracts';
import type { DictionaryRepository } from '@/main/database/dictionary-repository';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { normalizeSearchText, searchTokens } from '@/main/database/search-tokenizer';
import { parsePromptCommonInput } from '@/main/database/snapshot-content';

interface SourceRow extends JsonMap {
  source_kind: 'GENERATION_RUN' | 'IMPORTED_OUTPUT';
}

interface TermRow extends JsonMap {
  term_id: string;
  term_revision_id: string;
}

interface FrozenSource {
  assetId: string;
  seriesId: string;
  title: string;
  promptVersionId: string;
  versionNo: number;
  userInstruction: string;
  finalPrompt: string;
  modelKey: string | null;
  commonInput: PromptCommonInputDto;
}

interface TermDocument {
  termId: string;
  termRevisionId: string;
  title: string;
  titleLocale: ContentLocale;
  localizations: LocalizedTitleDto[];
  aliases: string[];
  positive: string;
  tokens: Set<string>;
}

function parseObject(value: unknown): JsonMap {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function localizedReason(locale: Locale, zh: string, en: string) {
  return locale === 'zh' ? zh : en;
}

function candidateTitle(clause: string, locale: Locale) {
  const han = clause.match(/[\u3400-\u9fff]/g) ?? [];
  const latin = clause.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
  if (locale === 'zh' && han.length) return han.slice(0, 10).join('');
  if (locale === 'en' && latin.length) {
    return latin
      .slice(0, 4)
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  }
  return clause.trim().slice(0, 48);
}

function safeArray<T>(value: unknown) {
  return Array.isArray(value) ? (value as T[]) : [];
}

function proposalDto(row: JsonMap): KnowledgeDistillationProposalDto {
  const input = parseObject(row.input_snapshot_json);
  const receipt = parseObject(row.capability_receipt_json);
  const result = parseObject(row.result_json);
  const acceptedSelection = parseObject(row.accepted_selection_json);
  return {
    id: text(row.id),
    sourceAssetId: text(row.source_asset_id),
    sourceSeriesId: text(row.source_series_id),
    sourcePromptVersionId: text(row.source_prompt_version_id),
    sourceVersionNo: Number(input.sourceVersionNo),
    sourceTitleZh: text(input.sourceTitleZh),
    sourceTitleEn: text(input.sourceTitleEn),
    status: row.accepted_palette_id ? 'ACCEPTED' : text(row.status) === 'CLOSED' ? 'CLOSED' : 'READY',
    acceptedPaletteId: row.accepted_palette_id == null ? null : text(row.accepted_palette_id),
    acceptedPaletteRevisionId: row.accepted_palette_revision_id == null ? null : text(row.accepted_palette_revision_id),
    acceptedAt: row.accepted_at == null ? null : text(row.accepted_at),
    acceptedSelection:
      row.accepted_palette_id == null
        ? null
        : {
            matchedTermIds: safeArray<string>(acceptedSelection.matchedTermIds),
            candidateIds: safeArray<string>(acceptedSelection.candidateIds),
          },
    capabilityReceipt: {
      visionAnalyzed: false,
      basis: 'PROMPT_VERSION',
      modelKey: receipt.modelKey == null ? null : text(receipt.modelKey),
    },
    inputSnapshot: {
      userInstruction: text(input.userInstruction),
      finalPrompt: text(input.finalPrompt),
      directTermIds: safeArray<string>(input.directTermIds),
      recipeIds: safeArray<string>(input.recipeIds),
      directTerms: safeArray<PromptCommonInputDto['directTerms'][number]>(input.directTerms),
      recipes: safeArray<PromptCommonInputDto['recipes'][number]>(input.recipes),
      referenceAssetIds: safeArray<string>(input.referenceAssetIds),
    },
    matchedTerms: safeArray<KnowledgeDistillationTermMatchDto>(result.matchedTerms),
    remainingTermCandidates: safeArray<KnowledgeDistillationTermCandidateDto>(result.remainingTermCandidates),
    recipeCandidate: result.recipeCandidate as KnowledgeDistillationProposalDto['recipeCandidate'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export class KnowledgeDistillationRepository {
  private readonly db: LibraryStorage['db'];

  constructor(
    private readonly storage: LibraryStorage,
    private readonly dictionary: DictionaryRepository,
  ) {
    this.db = storage.db;
  }

  list(sourceAssetId: string) {
    const rows = this.db
      .prepare(
        `SELECT proposal.*,
        acceptance.palette_id AS accepted_palette_id,
        acceptance.palette_revision_id AS accepted_palette_revision_id,
        acceptance.selection_json AS accepted_selection_json,
        acceptance.created_at AS accepted_at
      FROM knowledge_distillation_proposals proposal
      LEFT JOIN knowledge_distillation_acceptances acceptance ON acceptance.proposal_id = proposal.id
      WHERE proposal.source_asset_id = ? ORDER BY proposal.created_at DESC, proposal.id DESC`,
      )
      .all(sourceAssetId) as JsonMap[];
    return rows.map(proposalDto);
  }

  private proposal(proposalId: string) {
    return this.db
      .prepare(
        `SELECT proposal.*,
        acceptance.palette_id AS accepted_palette_id,
        acceptance.palette_revision_id AS accepted_palette_revision_id,
        acceptance.selection_json AS accepted_selection_json,
        acceptance.created_at AS accepted_at
      FROM knowledge_distillation_proposals proposal
      LEFT JOIN knowledge_distillation_acceptances acceptance ON acceptance.proposal_id = proposal.id
      WHERE proposal.id = ?`,
      )
      .get(proposalId) as JsonMap | undefined;
  }

  create(input: KnowledgeDistillationCreateInput) {
    const source = this.source(input.sourceAssetId, input.locale);
    const structuredMatches = this.structuredMatches(source, input.locale);
    const structuredIds = new Set(structuredMatches.map((match) => match.termId));
    const lexicalMatches = this.lexicalMatches(source, structuredIds, input.locale);
    const matchedTerms = [...structuredMatches, ...lexicalMatches];
    const remainingTermCandidates = this.remainingCandidates(source.finalPrompt, matchedTerms, input.locale);
    const matchedTermIds = [...new Set(matchedTerms.map((match) => match.termId))];
    const sourceTitle = source.title;
    const recipeCandidate = {
      name: `${sourceTitle} · ${input.locale === 'zh' ? '蒸馏配方' : 'Distilled recipe'}`,
      nameLocale: input.locale,
      description:
        input.locale === 'zh' ? '基于冻结 PromptVersion 的审核草稿' : 'Review draft based on the frozen PromptVersion',
      localizations: [],
      matchedTermIds,
      remainingTermCandidateIds: remainingTermCandidates.map((candidate) => candidate.id),
    };
    const proposalId = ulid();
    const timestamp = now();
    const inputSnapshot = {
      sourceVersionNo: source.versionNo,
      sourceTitleZh: sourceTitle,
      sourceTitleEn: '',
      userInstruction: source.userInstruction,
      finalPrompt: source.finalPrompt,
      directTermIds: source.commonInput.directTerms.map((term) => term.termId),
      recipeIds: source.commonInput.recipes.map((recipe) => recipe.paletteId),
      directTerms: source.commonInput.directTerms,
      recipes: source.commonInput.recipes,
      referenceAssetIds: [
        ...new Set([
          ...source.commonInput.directReferences.map((reference) => reference.assetId),
          ...source.commonInput.recipes.flatMap((recipe) => recipe.references.map((reference) => reference.assetId)),
        ]),
      ],
    };
    const capabilityReceipt = {
      visionAnalyzed: false as const,
      basis: 'PROMPT_VERSION' as const,
      modelKey: source.modelKey,
    };
    const result = { matchedTerms, remainingTermCandidates, recipeCandidate };

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO knowledge_distillation_proposals (
        id, source_asset_id, source_series_id, source_prompt_version_id, status,
        input_snapshot_json, capability_receipt_json, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)`,
        )
        .run(
          proposalId,
          source.assetId,
          source.seriesId,
          source.promptVersionId,
          JSON.stringify(inputSnapshot),
          JSON.stringify(capabilityReceipt),
          JSON.stringify(result),
          timestamp,
          timestamp,
        );
      this.storage.recordChange('KNOWLEDGE_DISTILLATION_PROPOSAL', proposalId, 'CREATE', {
        sourceAssetId: source.assetId,
        sourcePromptVersionId: source.promptVersionId,
        matchedTermCount: matchedTerms.length,
        remainingTermCandidateCount: remainingTermCandidates.length,
        visionAnalyzed: false,
      });
    })();

    const row = this.proposal(proposalId);
    if (!row) throw new Error('Created knowledge distillation proposal could not be loaded');
    return proposalDto(row);
  }

  accept(input: KnowledgeDistillationAcceptInput): KnowledgeDistillationAcceptResult {
    return this.db.transaction(() => {
      const row = this.proposal(input.proposalId);
      if (!row)
        throw new Error(localizedReason(input.locale, '蒸馏提案不存在', 'Knowledge distillation proposal not found'));

      const existingPaletteId = row.accepted_palette_id == null ? '' : text(row.accepted_palette_id);
      if (existingPaletteId) {
        const palette = this.dictionary.getWordPalettes(input.locale).find((item) => item.id === existingPaletteId);
        if (!palette) throw new Error(localizedReason(input.locale, '已接纳的配方不存在', 'Accepted recipe not found'));
        const mappingRows = this.db
          .prepare(
            `SELECT candidate_id, term_id
          FROM knowledge_distillation_term_acceptances WHERE proposal_id = ? ORDER BY created_at, id`,
          )
          .all(input.proposalId) as JsonMap[];
        return {
          proposal: proposalDto(row),
          palette,
          candidateTermIds: Object.fromEntries(
            mappingRows.map((mapping) => [text(mapping.candidate_id), text(mapping.term_id)]),
          ),
        };
      }
      if (text(row.status) !== 'READY') {
        throw new Error(localizedReason(input.locale, '蒸馏提案已关闭', 'Knowledge distillation proposal is closed'));
      }

      const proposal = proposalDto(row);
      const selectedMatchedIds = new Set(input.matchedTermIds);
      const selectedCandidateIds = new Set(input.candidateIds);
      const allowedMatchedIds = new Set(proposal.recipeCandidate.matchedTermIds);
      const allowedCandidateIds = new Set(proposal.recipeCandidate.remainingTermCandidateIds);
      if ([...selectedMatchedIds].some((termId) => !allowedMatchedIds.has(termId))) {
        throw new Error(
          localizedReason(
            input.locale,
            '包含不属于该提案的已有词条',
            'Selection contains a term outside this proposal',
          ),
        );
      }
      if ([...selectedCandidateIds].some((candidateId) => !allowedCandidateIds.has(candidateId))) {
        throw new Error(
          localizedReason(
            input.locale,
            '包含不属于该提案的候选词条',
            'Selection contains a candidate outside this proposal',
          ),
        );
      }

      const matchedTermIds = proposal.recipeCandidate.matchedTermIds.filter((termId) => selectedMatchedIds.has(termId));
      const candidates = proposal.remainingTermCandidates.filter((candidate) => selectedCandidateIds.has(candidate.id));
      if (!matchedTermIds.length && !candidates.length) {
        throw new Error(localizedReason(input.locale, '至少选择一个词条', 'Select at least one term'));
      }

      const timestamp = now();
      const candidateTermIds: Record<string, string> = {};
      for (const [index, candidate] of candidates.entries()) {
        const fallbackName = input.locale === 'zh' ? `蒸馏词条 ${index + 1}` : `Distilled term ${index + 1}`;
        const title = candidate.title.trim() || fallbackName;
        const titleLocale = candidate.titleLocale.trim().toLowerCase() || input.locale;
        const term = this.dictionary.createTerm({
          title,
          titleLocale,
          uiLocale: input.locale,
        });
        this.dictionary.saveTermDraft(
          {
            termId: term.id,
            title,
            titleLocale,
            definition: '',
            aliases: [],
            localizations: candidate.localizations.map((localization) => ({
              ...localization,
              definition: '',
              aliases: [],
            })),
            classificationIds: [],
            primaryDirectoryClassificationId: null,
            expressions: [
              {
                contextKey: DEFAULT_TERM_CONTEXT_KEY,
                modelKey: 'gpt-image-2',
                locale: titleLocale,
                positive: candidate.positive,
                negative: candidate.negative,
              },
            ],
          },
          input.locale,
        );
        candidateTermIds[candidate.id] = term.id;
      }

      const paletteTermIds = [...matchedTermIds, ...candidates.map((candidate) => candidateTermIds[candidate.id])];
      const palette = this.dictionary.createWordPalette({
        locale: input.locale,
        name: proposal.recipeCandidate.name,
        nameLocale: proposal.recipeCandidate.nameLocale,
        description: proposal.recipeCandidate.description,
        localizations: proposal.recipeCandidate.localizations,
        referenceAssetIds: [],
        parameters: [],
        promptNodes: paletteTermIds.flatMap((termId, index) => [
          ...(index ? [{ kind: 'TEXT' as const, promptFragment: ', ', negativeFragment: '' }] : []),
          { kind: 'TERM' as const, termId },
        ]),
      });
      const selection = {
        matchedTermIds,
        candidateIds: candidates.map((candidate) => candidate.id),
      };
      this.db
        .prepare(
          `INSERT INTO knowledge_distillation_acceptances
        (proposal_id, palette_id, palette_revision_id, selection_json, created_at)
        VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.proposalId, palette.id, palette.revisionId, JSON.stringify(selection), timestamp);
      for (const candidate of candidates) {
        this.db
          .prepare(
            `INSERT INTO knowledge_distillation_term_acceptances
          (id, proposal_id, candidate_id, term_id, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(ulid(), input.proposalId, candidate.id, candidateTermIds[candidate.id], timestamp);
      }
      this.db
        .prepare(
          `UPDATE knowledge_distillation_proposals
        SET status = 'CLOSED', updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, input.proposalId);
      this.storage.recordChange('KNOWLEDGE_DISTILLATION_PROPOSAL', input.proposalId, 'ACCEPT', {
        paletteId: palette.id,
        paletteRevisionId: palette.revisionId,
        ...selection,
        candidateTermIds,
      });

      const accepted = this.proposal(input.proposalId);
      if (!accepted) throw new Error('Accepted knowledge distillation proposal could not be loaded');
      return { proposal: proposalDto(accepted), palette, candidateTermIds };
    })();
  }

  private source(assetId: string, locale: Locale): FrozenSource {
    const row = this.db
      .prepare(
        `WITH RECURSIVE asset_lineage(asset_id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT transform.source_asset_id, lineage.depth + 1
      FROM image_transform_runs transform
      JOIN asset_lineage lineage ON lineage.asset_id = transform.output_asset_id
      WHERE transform.deleted_at IS NULL AND lineage.depth < 16
    )
    SELECT * FROM (
      SELECT 'GENERATION_RUN' AS source_kind, run.id AS source_id, run.model_key,
        run.created_at AS source_created_at, lineage.depth AS source_depth, series.id AS series_id,
        series.title, series.title_zh, series.title_en, version.id AS prompt_version_id,
        version.version_no, version.user_intent, version.final_prompt, snapshot.common_input_json
      FROM generation_runs run
      JOIN asset_lineage lineage ON lineage.asset_id = run.result_asset_id
      JOIN prompt_versions version ON version.id = run.prompt_version_id
      JOIN prompt_series series ON series.id = version.series_id
      JOIN prompt_input_snapshots snapshot ON snapshot.prompt_version_id = version.id
      WHERE run.status = 'SUCCEEDED'
      UNION ALL
      SELECT 'IMPORTED_OUTPUT' AS source_kind, imported.id AS source_id, imported.model_key,
        imported.created_at AS source_created_at, lineage.depth AS source_depth, series.id AS series_id,
        series.title, series.title_zh, series.title_en, version.id AS prompt_version_id,
        version.version_no, version.user_intent, version.final_prompt, snapshot.common_input_json
      FROM creation_output_imports imported
      JOIN asset_lineage lineage ON lineage.asset_id = imported.image_asset_id
      JOIN prompt_versions version ON version.id = imported.prompt_version_id
      JOIN prompt_series series ON series.id = version.series_id
      JOIN prompt_input_snapshots snapshot ON snapshot.prompt_version_id = version.id
      WHERE imported.deleted_at IS NULL
    ) ORDER BY source_depth, source_created_at DESC, source_id DESC LIMIT 1`,
      )
      .get(assetId) as SourceRow | undefined;
    if (!row)
      throw new Error(
        localizedReason(
          locale,
          '此产出没有可用于蒸馏的冻结 PromptVersion',
          'This output has no frozen PromptVersion to distill',
        ),
      );
    const commonInput = parsePromptCommonInput(row.common_input_json);
    const title = text(row.title);
    return {
      assetId,
      seriesId: text(row.series_id),
      title: title,
      promptVersionId: text(row.prompt_version_id),
      versionNo: Number(row.version_no),
      userInstruction: commonInput.userInstruction,
      finalPrompt: text(row.final_prompt),
      modelKey: row.model_key == null ? null : text(row.model_key),
      commonInput,
    };
  }

  private structuredMatches(source: FrozenSource, locale: Locale) {
    const references = [
      ...source.commonInput.directTerms.map((term) => ({ ...term, source: 'DIRECT_TERM' as const })),
      ...source.commonInput.recipes.flatMap((recipe) =>
        recipe.terms.map((term) => ({ ...term, source: 'RECIPE_TERM' as const })),
      ),
    ];
    const seen = new Set<string>();
    return references.flatMap((reference) => {
      if (seen.has(reference.termId)) return [];
      seen.add(reference.termId);
      const term = this.term(reference.termId, reference.termRevisionId, source.modelKey);
      if (!term) return [];
      return [
        this.match(
          term,
          reference.source,
          1,
          localizedReason(
            locale,
            reference.source === 'DIRECT_TERM' ? '来自冻结的直接词条绑定' : '来自冻结的配方词条绑定',
            reference.source === 'DIRECT_TERM' ? 'Frozen direct-term binding' : 'Frozen recipe-term binding',
          ),
        ),
      ];
    });
  }

  private lexicalMatches(source: FrozenSource, excludedTermIds: Set<string>, locale: Locale) {
    const documents = this.currentTerms(source.modelKey).filter((term) => !excludedTermIds.has(term.termId));
    const promptText = normalizeSearchText(source.finalPrompt);
    const promptTokens = searchTokens(source.finalPrompt);
    const documentFrequency = new Map<string, number>();
    for (const document of documents) {
      for (const token of document.tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    const weight = (token: string) =>
      Math.log((documents.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 0.15;

    return documents
      .flatMap((document) => {
        const phrases = [document.title, ...document.localizations.map((item) => item.title), ...document.aliases]
          .map(normalizeSearchText)
          .filter((phrase) => phrase.length >= 2);
        const exactName = phrases.some((phrase) => promptText.includes(phrase));
        const exactExpression =
          normalizeSearchText(document.positive).length >= 6 &&
          promptText.includes(normalizeSearchText(document.positive));
        let matchedWeight = 0;
        let totalWeight = 0;
        let matchedCount = 0;
        for (const token of document.tokens) {
          const tokenWeight = weight(token);
          totalWeight += tokenWeight;
          if (promptTokens.has(token)) {
            matchedWeight += tokenWeight;
            matchedCount += 1;
          }
        }
        const coverage = totalWeight ? matchedWeight / totalWeight : 0;
        if (!exactName && !exactExpression && (matchedCount < 2 || coverage < 0.72)) return [];
        const confidence = exactName ? 0.96 : exactExpression ? 0.93 : Math.min(0.9, 0.58 + coverage * 0.38);
        return [{ document, confidence }];
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 12)
      .map(({ document, confidence }) =>
        this.match(
          document,
          'PROMPT_MATCH',
          Number(confidence.toFixed(2)),
          localizedReason(
            locale,
            '冻结 Prompt 与现有词条表达式匹配',
            'Frozen Prompt matched an existing term expression',
          ),
        ),
      );
  }

  private remainingCandidates(finalPrompt: string, matches: KnowledgeDistillationTermMatchDto[], locale: Locale) {
    const coveredTokens = searchTokens(matches.map((match) => match.positive).join(' '));
    const seen = new Set<string>();
    const clauses = finalPrompt
      .split(/[\n,，;；。]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);
    const candidates: KnowledgeDistillationTermCandidateDto[] = [];
    for (const clause of clauses) {
      if (clause.length < 8 || clause.length > 500) continue;
      const key = normalizeSearchText(clause);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const clauseTokens = searchTokens(clause);
      if (!clauseTokens.size) continue;
      const coveredCount = [...clauseTokens].filter((token) => coveredTokens.has(token)).length;
      if (coveredCount / clauseTokens.size >= 0.65) continue;
      const negative = /^(avoid|exclude|without|no\b|禁止|避免|不要|不得|无\b)/i.test(clause);
      candidates.push({
        id: ulid(),
        title: candidateTitle(clause, locale),
        titleLocale: locale,
        localizations: [],
        positive: negative ? '' : clause,
        negative: negative ? clause : '',
        evidenceText: clause,
        reason: localizedReason(locale, '未被已匹配词条充分覆盖', 'Not sufficiently covered by matched terms'),
      });
      if (candidates.length >= 8) break;
    }
    return candidates;
  }

  private match(
    term: TermDocument,
    source: KnowledgeDistillationMatchSource,
    confidence: number,
    reason: string,
  ): KnowledgeDistillationTermMatchDto {
    return {
      termId: term.termId,
      termRevisionId: term.termRevisionId,
      title: term.title,
      titleLocale: term.titleLocale,
      localizations: term.localizations,
      positive: term.positive,
      source,
      confidence,
      reason,
    };
  }

  private term(termId: string, termRevisionId: string, modelKey: string | null) {
    const row = this.db
      .prepare(
        `SELECT term.id AS term_id, revision.id AS term_revision_id,
        revision.title, revision.title_locale,
        COALESCE((SELECT expression.positive_expression FROM term_expressions expression
          WHERE expression.term_revision_id = revision.id
          ORDER BY CASE WHEN expression.model_key = ? THEN 0 ELSE 1 END, expression.id DESC
          LIMIT 1), '') AS positive_expression,
        COALESCE((SELECT group_concat(alias.value, char(31)) FROM term_aliases alias
          WHERE alias.term_revision_id = revision.id), '') AS aliases
      FROM terms term JOIN term_revisions revision ON revision.id = ?
      WHERE term.id = ? AND revision.term_id = term.id`,
      )
      .get(modelKey ?? '', termRevisionId, termId) as TermRow | undefined;
    if (!row) return null;
    const localizations = this.localizedTitles([termRevisionId]).get(termRevisionId) ?? [];
    return this.termDocument(row, localizations);
  }

  private currentTerms(modelKey: string | null) {
    const rows = this.db
      .prepare(
        `SELECT term.id AS term_id, revision.id AS term_revision_id,
        revision.title, revision.title_locale,
        COALESCE((SELECT expression.positive_expression FROM term_expressions expression
          WHERE expression.term_revision_id = revision.id
          ORDER BY CASE WHEN expression.model_key = ? THEN 0 ELSE 1 END, expression.id DESC
          LIMIT 1), '') AS positive_expression,
        COALESCE((SELECT group_concat(alias.value, char(31)) FROM term_aliases alias
          WHERE alias.term_revision_id = revision.id), '') AS aliases
      FROM terms term JOIN term_revisions revision ON revision.id = term.current_revision_id
      WHERE term.archived_at IS NULL`,
      )
      .all(modelKey ?? '') as TermRow[];
    const localizations = this.localizedTitles(rows.map((row) => text(row.term_revision_id)));
    return rows.map((row) => this.termDocument(row, localizations.get(text(row.term_revision_id)) ?? []));
  }

  private localizedTitles(revisionIds: string[]) {
    const byRevision = new Map<string, LocalizedTitleDto[]>();
    if (!revisionIds.length) return byRevision;
    const rows = this.db
      .prepare(
        `SELECT term_revision_id, locale, title FROM term_localizations
        WHERE term_revision_id IN (${revisionIds.map(() => '?').join(',')})
        ORDER BY term_revision_id, locale`,
      )
      .all(...revisionIds) as JsonMap[];
    for (const row of rows) {
      const revisionId = text(row.term_revision_id);
      const items = byRevision.get(revisionId) ?? [];
      items.push({ locale: text(row.locale), title: text(row.title) });
      byRevision.set(revisionId, items);
    }
    return byRevision;
  }

  private termDocument(row: TermRow, localizations: LocalizedTitleDto[]): TermDocument {
    const title = text(row.title);
    const titleLocale = text(row.title_locale);
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
  }
}
