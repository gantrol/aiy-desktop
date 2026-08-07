import { ulid } from 'ulid';
import {
  DEFAULT_TERM_CONTEXT_KEY,
  type ExecutionInputSnapshotDto,
  type GenerationExecutionCommonInputDto,
  type GenerationInput,
  type ImageGenerationRouteDto,
  type ImageGenerationRouteSnapshotDto,
  type Locale,
  type PromptCommonAssetReferenceDto,
  type PromptCommonInputDto,
  type PromptCommonRecipeReferenceDto,
  type PromptInputSnapshotDto,
} from '@/shared/contracts';
import { CODEX_APP_SERVER_IMAGE_MODEL_KEY, CODEX_IMAGE_MODEL_ID, OPENAI_IMAGE_MODEL_KEY } from '@/shared/extension-ids';
import {
  resolvePromptComposition,
  type PromptRecipeContentExpressionInput,
  type PromptRecipeUseInput,
  type PromptTermInput,
  type ResolvedPromptComposition,
} from '@/shared/prompt-composition';
import type { GenerationExecutionRequestSnapshot } from '@/main/generation-models/types';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { readRecipeContentSnapshot, recipeContentTerms } from '@/main/database/word-palette-content';
import {
  canonicalSnapshotJson,
  promptInputContentHash,
  promptInputSourceKind,
  parsePromptCommonInput,
  snapshotContentHash,
} from '@/main/database/snapshot-content';

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const secretFieldNames = new Set([
  'authorization',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'secret',
  'password',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
]);

function assertNoSecretFields(value: unknown, path = 'actualRequest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (secretFieldNames.has(normalizedKey)) {
      throw new Error(`Generation execution request contains a credential field: ${path}.${key}`);
    }
    assertNoSecretFields(item, `${path}.${key}`);
  }
}

function parsedObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parsedMaps(value: unknown): JsonMap[] {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function sortedRecord(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export interface FreezeGenerationExecutionInput {
  runId: string;
  generationInput: GenerationInput;
  promptInput: PromptCommonInputDto;
  route: ImageGenerationRouteDto;
  request: GenerationExecutionRequestSnapshot;
}

export class ExecutionSnapshotRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  captureCommonInput(
    input: Pick<
      GenerationInput,
      'manualPrompt' | 'promptNodes' | 'termPromptLocale' | 'termIds' | 'wordPaletteReferences' | 'referenceAssetIds'
    >,
  ): PromptCommonInputDto {
    const defaultTermPromptLocale = input.termPromptLocale === 'zh' ? ('zh' as const) : ('en' as const);
    const promptLocaleByTermId = new Map(
      (input.promptNodes ?? []).flatMap((node) =>
        node.kind === 'TERM' && node.promptLocale ? [[node.termId, node.promptLocale] as const] : [],
      ),
    );
    const directTerms = unique(input.termIds).map((termId) => {
      const row = this.db
        .prepare(
          `SELECT id, current_revision_id FROM terms
        WHERE id = ?`,
        )
        .get(termId) as JsonMap | undefined;
      if (!row?.current_revision_id) throw new Error(`Term revision not found: ${termId}`);
      const termRevisionId = text(row.current_revision_id);
      const promptLocale = promptLocaleByTermId.get(termId) ?? defaultTermPromptLocale;
      return {
        termId: text(row.id),
        termRevisionId,
        ...(promptLocale !== defaultTermPromptLocale ? { promptLocale } : {}),
        packSources: this.packSources('TERM', text(row.id), termRevisionId),
      };
    });
    const recipes = input.wordPaletteReferences.map((reference): PromptCommonRecipeReferenceDto => {
      const release = this.db
        .prepare(
          `SELECT revision.id, revision.name, revision.name_locale,
          COALESCE((
            SELECT json_group_array(json_object('locale', localization.locale, 'name', localization.name))
            FROM (
              SELECT locale, name FROM word_palette_revision_localizations
              WHERE palette_revision_id = revision.id ORDER BY locale
            ) localization
          ), '[]') AS localizations_json
        FROM word_palette_revisions revision
        WHERE id = ? AND palette_id = ?`,
        )
        .get(reference.paletteRevisionId, reference.paletteId) as JsonMap | undefined;
      if (!release) throw new Error(`Word palette revision not found: ${reference.paletteRevisionId}`);
      const revisionTerms = (
        this.db
          .prepare(
            `SELECT revision_term.term_id, term.current_revision_id
        FROM word_palette_revision_terms revision_term
        JOIN terms term ON term.id = revision_term.term_id
        WHERE revision_term.palette_revision_id = ?
        ORDER BY revision_term.sort_order, revision_term.rowid`,
          )
          .all(reference.paletteRevisionId) as JsonMap[]
      ).map((row) => {
        if (!row.current_revision_id) throw new Error(`Term revision not found: ${text(row.term_id)}`);
        return {
          termId: text(row.term_id),
          termRevisionId: text(row.current_revision_id),
        };
      });
      const parameters = (
        this.db
          .prepare(
            `SELECT parameter.id AS parameter_revision_id,
          parameter.stable_key, option.id AS option_id, option.value_key
        FROM word_palette_revision_parameters parameter
        JOIN word_palette_revision_parameter_options option
          ON option.parameter_revision_id = parameter.id
        WHERE parameter.palette_revision_id = ?
        ORDER BY parameter.sort_order, parameter.rowid, option.sort_order, option.rowid`,
          )
          .all(reference.paletteRevisionId) as JsonMap[]
      )
        .filter((row) => reference.parameterValues[text(row.stable_key)] === text(row.value_key))
        .map((row) => ({
          parameterRevisionId: text(row.parameter_revision_id),
          stableKey: text(row.stable_key),
          optionId: text(row.option_id),
          valueKey: text(row.value_key),
        }));
      const contentNodes = readRecipeContentSnapshot(this.db, reference.paletteRevisionId, reference.parameterValues);
      const terms = [...revisionTerms, ...recipeContentTerms(contentNodes)]
        .filter((term, index, all) => all.findIndex((item) => item.termId === term.termId) === index)
        .map((term) => ({
          ...term,
          packSources: this.packSources('TERM', term.termId, term.termRevisionId),
        }));
      const references = (
        this.db
          .prepare(
            `SELECT asset.id, asset.object_hash
        FROM word_palette_revision_media media
        JOIN image_assets asset ON asset.id = media.image_asset_id
        WHERE media.palette_revision_id = ? AND asset.deleted_at IS NULL
        ORDER BY media.sort_order, media.rowid`,
          )
          .all(reference.paletteRevisionId) as JsonMap[]
      ).map((row): PromptCommonAssetReferenceDto => ({
        assetId: text(row.id),
        contentHash: text(row.object_hash),
        role: 'RECIPE_REFERENCE',
        packSources: this.assetPackSources(text(row.id), text(row.object_hash)),
      }));
      return {
        useId: `${reference.paletteId}:${reference.paletteRevisionId}`,
        paletteId: reference.paletteId,
        paletteRevisionId: reference.paletteRevisionId,
        name: text(release.name),
        nameLocale: text(release.name_locale),
        localizations: parsedMaps(release.localizations_json).map((localization) => ({
          locale: text(localization.locale),
          name: text(localization.name),
        })),
        promptLocale: reference.promptLocale,
        parameterValues: sortedRecord(reference.parameterValues),
        terms,
        parameters,
        contentNodes,
        references,
        packSources: this.packSources('RECIPE', reference.paletteId, reference.paletteRevisionId),
      };
    });
    const directReferences = unique(input.referenceAssetIds).map((assetId): PromptCommonAssetReferenceDto => {
      const row = this.db
        .prepare(
          `SELECT id, object_hash FROM image_assets
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .get(assetId) as JsonMap | undefined;
      if (!row) throw new Error(`Reference asset not found: ${assetId}`);
      return {
        assetId: text(row.id),
        contentHash: text(row.object_hash),
        role: 'DIRECT_REFERENCE',
        packSources: this.assetPackSources(text(row.id), text(row.object_hash)),
      };
    });
    if (input.promptNodes) {
      const directTermIds = new Set(directTerms.map((term) => term.termId));
      const recipePaletteIds = new Set(recipes.map((recipe) => recipe.paletteId));
      const missingTerm = input.promptNodes.find((node) => node.kind === 'TERM' && !directTermIds.has(node.termId));
      if (missingTerm?.kind === 'TERM') {
        throw new Error(`Structured prompt term is missing its reference: ${missingTerm.termId}`);
      }
      const missingRecipe = input.promptNodes.find(
        (node) => node.kind === 'RECIPE' && !recipePaletteIds.has(node.paletteId),
      );
      if (missingRecipe?.kind === 'RECIPE') {
        throw new Error(`Structured prompt recipe is missing its reference: ${missingRecipe.paletteId}`);
      }
    }
    const contentNodes = input.promptNodes
      ? (() => {
          const directTermIds = new Set(directTerms.map((term) => term.termId));
          const recipeUseIdByPaletteId = new Map(recipes.map((recipe) => [recipe.paletteId, recipe.useId]));
          const seenTerms = new Set<string>();
          const seenRecipes = new Set<string>();
          const ordered: NonNullable<PromptCommonInputDto['contentNodes']> = [];
          for (const node of input.promptNodes ?? []) {
            if (node.kind === 'TEXT') {
              if (node.text) ordered.push({ kind: 'TEXT', text: node.text });
              continue;
            }
            if (node.kind === 'TERM' && directTermIds.has(node.termId) && !seenTerms.has(node.termId)) {
              seenTerms.add(node.termId);
              ordered.push({ kind: 'TERM', termId: node.termId });
              continue;
            }
            if (node.kind === 'RECIPE') {
              const useId = recipeUseIdByPaletteId.get(node.paletteId);
              if (useId && !seenRecipes.has(useId)) {
                seenRecipes.add(useId);
                ordered.push({ kind: 'RECIPE', useId });
              }
            }
          }
          for (const term of directTerms) {
            if (!seenTerms.has(term.termId)) ordered.push({ kind: 'TERM', termId: term.termId });
          }
          for (const recipe of recipes) {
            if (!seenRecipes.has(recipe.useId)) ordered.push({ kind: 'RECIPE', useId: recipe.useId });
          }
          return ordered;
        })()
      : undefined;
    return {
      userInstruction: contentNodes
        ? contentNodes
            .flatMap((node) => (node.kind === 'TEXT' ? [node.text] : []))
            .join('')
            .trim()
        : input.manualPrompt,
      directTermPromptLocale: defaultTermPromptLocale,
      directTerms,
      recipes,
      directReferences,
      ...(contentNodes ? { contentNodes } : {}),
    };
  }

  promptInputHash(input: PromptCommonInputDto) {
    return promptInputContentHash(input);
  }

  freezePromptInput(promptVersionId: string, promptInput: PromptCommonInputDto): PromptInputSnapshotDto {
    const sourceKind = promptInputSourceKind(promptInput);
    const contentHash = this.promptInputHash(promptInput);
    const existing = this.db
      .prepare(
        `SELECT id, content_hash FROM prompt_input_snapshots
      WHERE prompt_version_id = ?`,
      )
      .get(promptVersionId) as JsonMap | undefined;
    if (existing && text(existing.content_hash) !== contentHash) {
      throw new Error('PromptVersion already has a different immutable input snapshot');
    }
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO prompt_input_snapshots
        (id, prompt_version_id, source_kind, user_instruction, common_input_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          promptVersionId,
          sourceKind,
          promptInput.userInstruction,
          canonicalSnapshotJson(promptInput),
          contentHash,
          now(),
        );
    }
    return this.getPromptInputSnapshot(promptVersionId)!;
  }

  getCommonInput(promptVersionId: string): PromptCommonInputDto {
    const snapshot = this.db
      .prepare(
        `SELECT common_input_json FROM prompt_input_snapshots
      WHERE prompt_version_id = ?`,
      )
      .get(promptVersionId) as JsonMap | undefined;
    if (!snapshot) throw new Error(`Prompt input snapshot not found: ${promptVersionId}`);
    return parsePromptCommonInput(snapshot.common_input_json);
  }

  resolveGenerationInput(input: GenerationInput, commonInput: PromptCommonInputDto): GenerationInput {
    const composition = this.resolveComposition(commonInput, input.modelKey);
    if (!composition.commonExpression.trim()) throw new Error('Prompt is empty');
    return {
      ...input,
      manualPrompt: commonInput.userInstruction,
      prompt: composition.commonExpression,
      resolvedPrompt: composition,
      termPromptLocale: commonInput.directTermPromptLocale,
      referenceAssetIds: unique([
        ...commonInput.directReferences.map((reference) => reference.assetId),
        ...commonInput.recipes.flatMap((recipe) => recipe.references.map((reference) => reference.assetId)),
      ]),
    };
  }

  freezeGenerationExecution(input: FreezeGenerationExecutionInput) {
    const createdAt = now();
    const descriptor = jsonValue(input.route) as ImageGenerationRouteDto;
    const modelHash = snapshotContentHash(descriptor);
    const commonInput: GenerationExecutionCommonInputDto = {
      promptInput: input.promptInput,
      // Renderer composition is advisory only. The execution fact is always
      // resolved in the main process from frozen, model-neutral references.
      resolvedPrompt: this.resolveComposition(input.promptInput, input.generationInput.modelKey),
      referenceAssetIds: unique(input.generationInput.referenceAssetIds),
      canvasPresetKey: input.generationInput.canvasPresetKey,
      width: input.generationInput.width,
      height: input.generationInput.height,
      quality: input.generationInput.quality,
    };
    const actualRequest = jsonValue(input.request.actualRequest);
    if (!actualRequest || typeof actualRequest !== 'object' || Array.isArray(actualRequest)) {
      throw new Error('Generation execution request must be a JSON object');
    }
    assertNoSecretFields(actualRequest);
    const executionPayload = {
      route: input.request.route,
      requestSchema: input.request.requestSchema,
      commonInput,
      actualRequest,
      clientRequestText: input.request.clientRequestText ?? null,
    };
    const executionHash = snapshotContentHash(executionPayload);

    return this.db.transaction(() => {
      const run = this.db.prepare(`SELECT prompt_version_id FROM generation_runs WHERE id = ?`).get(input.runId) as
        JsonMap | undefined;
      if (!run) throw new Error(`Generation run not found: ${input.runId}`);
      const promptVersionId = text(run.prompt_version_id);
      this.freezePromptInput(promptVersionId, input.promptInput);

      const existingExecution = this.db
        .prepare(
          `SELECT snapshot.content_hash AS execution_hash,
          model.content_hash AS model_hash
        FROM execution_input_snapshots snapshot
        JOIN generation_model_snapshots model ON model.id = snapshot.model_snapshot_id
        WHERE snapshot.generation_run_id = ?`,
        )
        .get(input.runId) as JsonMap | undefined;
      if (existingExecution) {
        if (
          text(existingExecution.execution_hash) !== executionHash ||
          text(existingExecution.model_hash) !== modelHash
        ) {
          throw new Error('GenerationRun already has different immutable execution snapshots');
        }
        return this.getRunSnapshots(input.runId);
      }

      const modelSnapshotId = ulid();
      this.db
        .prepare(
          `INSERT INTO generation_model_snapshots
        (id, generation_run_id, model_key, provider_key, model_id, descriptor_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          modelSnapshotId,
          input.runId,
          input.route.key,
          input.route.providerKey,
          input.route.modelId,
          canonicalSnapshotJson(descriptor),
          modelHash,
          createdAt,
        );
      this.db
        .prepare(
          `INSERT INTO execution_input_snapshots
        (id, generation_run_id, model_snapshot_id, route_kind, request_schema, common_input_json,
         actual_request_json, client_request_text, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          input.runId,
          modelSnapshotId,
          input.request.route,
          input.request.requestSchema,
          canonicalSnapshotJson(commonInput),
          canonicalSnapshotJson(actualRequest),
          input.request.clientRequestText ?? null,
          executionHash,
          createdAt,
        );
      this.storage.recordChange('GENERATION_RUN', input.runId, 'FREEZE_EXECUTION_INPUT', {
        modelKey: input.route.key,
        route: input.request.route,
        requestSchema: input.request.requestSchema,
      });
      return this.getRunSnapshots(input.runId);
    })();
  }

  getPromptInputSnapshot(promptVersionId: string): PromptInputSnapshotDto | null {
    const row = this.db
      .prepare(
        `SELECT * FROM prompt_input_snapshots
      WHERE prompt_version_id = ?`,
      )
      .get(promptVersionId) as JsonMap | undefined;
    if (!row) return null;
    return {
      id: text(row.id),
      sourceKind: text(row.source_kind) as PromptInputSnapshotDto['sourceKind'],
      commonInput: parsePromptCommonInput(row.common_input_json),
      contentHash: text(row.content_hash),
      createdAt: text(row.created_at),
    };
  }

  getRunSnapshots(runId: string): {
    modelSnapshot: ImageGenerationRouteSnapshotDto | null;
    executionInputSnapshot: ExecutionInputSnapshotDto | null;
  } {
    const row = this.db
      .prepare(
        `SELECT model.id AS model_snapshot_id, model.descriptor_json,
        model.content_hash AS model_content_hash, model.created_at AS model_created_at,
        execution.id AS execution_snapshot_id, execution.route_kind, execution.request_schema,
        execution.common_input_json, execution.actual_request_json, execution.client_request_text,
        execution.content_hash AS execution_content_hash, execution.created_at AS execution_created_at
      FROM generation_model_snapshots model
      JOIN execution_input_snapshots execution ON execution.model_snapshot_id = model.id
      WHERE model.generation_run_id = ?`,
      )
      .get(runId) as JsonMap | undefined;
    if (!row) return { modelSnapshot: null, executionInputSnapshot: null };
    return {
      modelSnapshot: {
        id: text(row.model_snapshot_id),
        descriptor: parsedObject(row.descriptor_json) as unknown as ImageGenerationRouteDto,
        contentHash: text(row.model_content_hash),
        createdAt: text(row.model_created_at),
      },
      executionInputSnapshot: {
        id: text(row.execution_snapshot_id),
        route: text(row.route_kind) as ExecutionInputSnapshotDto['route'],
        requestSchema: text(row.request_schema),
        commonInput: parsedObject(row.common_input_json) as unknown as GenerationExecutionCommonInputDto,
        actualRequest: parsedObject(row.actual_request_json),
        clientRequestText: row.client_request_text == null ? null : text(row.client_request_text),
        contentHash: text(row.execution_content_hash),
        createdAt: text(row.execution_created_at),
      },
    };
  }

  private assetPackSources(assetId: string, contentHash: string) {
    return (
      this.db
        .prepare(
          `SELECT pack.id AS pack_id, release.id AS release_id,
        item.id AS release_item_id
      FROM pack_object_links link
      JOIN pack_release_items item ON item.id = link.release_item_id
      JOIN pack_releases release ON release.id = item.release_id
      JOIN packs pack ON pack.id = release.pack_id
      WHERE link.local_object_type IN ('ASSET', 'IMAGE_ASSET')
        AND link.local_object_id = ? AND link.local_revision_id = ?
        AND link.deleted_at IS NULL
      ORDER BY pack.id, release.id, item.id`,
        )
        .all(assetId, contentHash) as JsonMap[]
    ).map((row) => ({
      packId: text(row.pack_id),
      packReleaseId: text(row.release_id),
      packReleaseItemId: text(row.release_item_id),
    }));
  }

  private packSources(localObjectType: 'TERM' | 'RECIPE', localObjectId: string, localRevisionId: string) {
    return (
      this.db
        .prepare(
          `SELECT pack.id AS pack_id, release.id AS release_id,
        item.id AS release_item_id
      FROM pack_object_links link
      JOIN pack_release_items item ON item.id = link.release_item_id
      JOIN pack_releases release ON release.id = item.release_id
      JOIN packs pack ON pack.id = release.pack_id
      WHERE link.local_object_type = ? AND link.local_object_id = ?
        AND link.local_revision_id = ? AND link.deleted_at IS NULL
      ORDER BY pack.id, release.id, item.id`,
        )
        .all(localObjectType, localObjectId, localRevisionId) as JsonMap[]
    ).map((row) => ({
      packId: text(row.pack_id),
      packReleaseId: text(row.release_id),
      packReleaseItemId: text(row.release_item_id),
    }));
  }

  private resolveComposition(commonInput: PromptCommonInputDto, modelKey: string): ResolvedPromptComposition {
    // API, App Server, and CLI are separate execution choices for the same
    // image model, so all consume the existing GPT Image 2 term expressions.
    const expressionModelKey =
      modelKey === CODEX_APP_SERVER_IMAGE_MODEL_KEY || modelKey === OPENAI_IMAGE_MODEL_KEY
        ? CODEX_IMAGE_MODEL_ID
        : modelKey;
    if (commonInput.flatPrompt !== undefined) {
      const fallback = resolvePromptComposition({
        userInstruction: commonInput.flatPrompt,
        directTerms: [],
        recipes: [],
        exclusions: [],
        specs: [],
      });
      const fallbackWithNegative = {
        ...fallback,
        negativeExpression: commonInput.flatNegativePrompt ?? fallback.negativeExpression,
      };
      const resolved = commonInput.flatResolvedPrompt;
      if (!resolved?.commonExpression.trim()) return fallbackWithNegative;
      return {
        ...fallback,
        commonExpression: resolved.commonExpression,
        negativeExpression: resolved.negativeExpression,
      };
    }
    return resolvePromptComposition({
      userInstruction: commonInput.userInstruction,
      directTerms: commonInput.directTerms.flatMap(
        (term) =>
          this.termExpression(term, expressionModelKey, term.promptLocale ?? commonInput.directTermPromptLocale) ?? [],
      ),
      recipes: commonInput.recipes.map((recipe) => this.recipeExpression(recipe, expressionModelKey)),
      ...(commonInput.contentNodes
        ? {
            contentNodes: commonInput.contentNodes.map((node) =>
              node.kind === 'TEXT'
                ? { kind: 'TEXT' as const, text: node.text }
                : node.kind === 'TERM'
                  ? { kind: 'TERM' as const, stableId: node.termId }
                  : { kind: 'RECIPE' as const, useId: node.useId },
            ),
          }
        : {}),
      exclusions: [],
      specs: [],
    });
  }

  private termExpression(
    term: { termId: string; termRevisionId: string },
    modelKey: string,
    locale: Locale,
  ): PromptTermInput | null {
    const row = this.db
      .prepare(
        `SELECT COALESCE(localization.title, revision.title) AS label,
        expression.id AS expression_id,
        expression.positive_expression,
        expression.negative_expression
      FROM term_revisions revision
      LEFT JOIN term_localizations localization
        ON localization.term_revision_id = revision.id AND localization.locale = ?
      LEFT JOIN term_expressions expression ON expression.id = (
        SELECT candidate.id FROM term_expressions candidate
        JOIN term_context_profile_revisions profile_revision
          ON profile_revision.id = candidate.context_profile_revision_id
        JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
        WHERE candidate.term_revision_id = revision.id AND candidate.model_key = ?
          AND profile.stable_key = ?
        ORDER BY CASE
          WHEN candidate.locale = ? THEN 0
          WHEN candidate.locale = revision.title_locale THEN 1
          WHEN candidate.locale = 'en' THEN 2
          ELSE 3 END,
          candidate.id DESC LIMIT 1
      )
      WHERE revision.id = ? AND revision.term_id = ?`,
      )
      .get(locale, modelKey, DEFAULT_TERM_CONTEXT_KEY, locale, term.termRevisionId, term.termId) as JsonMap | undefined;
    if (!row?.expression_id) return null;
    const positiveExpression = text(row.positive_expression);
    const negativeExpression = text(row.negative_expression);
    if (!positiveExpression.trim() && !negativeExpression.trim()) return null;
    return {
      stableId: term.termId,
      revisionId: term.termRevisionId,
      expressionRevisionId: text(row.expression_id),
      label: text(row.label),
      positiveExpression,
      negativeExpression,
    };
  }

  private recipeExpression(recipe: PromptCommonRecipeReferenceDto, modelKey: string): PromptRecipeUseInput {
    const contentExpressions = recipe.contentNodes.flatMap<PromptRecipeContentExpressionInput>((node) => {
      if (node.kind === 'TERM') {
        const term = this.termExpression(node.term, modelKey, recipe.promptLocale);
        return term ? [{ kind: 'TERM' as const, term }] : [];
      }
      if (node.kind === 'TEXT') {
        return [
          {
            kind: 'RECIPE_FRAGMENT' as const,
            stableId: node.id,
            positiveExpression: node.promptFragment,
            negativeExpression: node.negativeFragment,
          },
        ];
      }
      const parameter = node.parameter;
      if (!parameter) return [];
      return node.contents.flatMap<PromptRecipeContentExpressionInput>((content) => {
        if (content.kind === 'TERM') {
          const term = this.termExpression(content.term, modelKey, recipe.promptLocale);
          return term ? [{ kind: 'TERM' as const, term }] : [];
        }
        return [
          {
            kind: 'RECIPE_PARAMETER' as const,
            parameter: {
              stableId: `${parameter.parameterRevisionId}:${content.id}`,
              revisionId: parameter.parameterRevisionId,
              optionStableId: parameter.optionId,
              expressionRevisionId: content.id,
              positiveExpression: content.promptFragment,
              negativeExpression: content.negativeFragment,
            },
          },
        ];
      });
    });
    return {
      useId: recipe.useId,
      stableId: recipe.paletteId,
      revisionId: recipe.paletteRevisionId,
      terms: [],
      parameterExpressions: [],
      contentExpressions,
      references: recipe.references.map((reference) => ({
        stableId: reference.assetId,
        revisionId: reference.contentHash,
        contentHash: reference.contentHash,
        role: 'REFERENCE',
      })),
    };
  }
}
