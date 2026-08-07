import { describe, expect, it, vi } from 'vitest';
import type { GenerationInput, GenerationModelDto } from '../src/shared/contracts';
import { buildCodexImageOuterRequest, type CodexAdapter } from '../src/main/codex';
import { GenerationCoordinator } from '../src/main/generation';
import { CodexImageModel, GenerationModelRegistry, type GenerationModel } from '../src/main/generation-models';
import { createTestLibrary } from './support/test-library';

function descriptor(key: string): GenerationModelDto {
  return {
    key,
    name: key,
    provider: 'Test provider',
    providerKey: 'test',
    modelId: key,
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: 8,
    capabilities: ['GENERATE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
  };
}

function seedModelSpecificTerm(database: ReturnType<typeof createTestLibrary>['database']) {
  const createdAt = '2026-07-30T00:00:00.000Z';
  database.db
    .prepare(
      `INSERT INTO terms
    (id, stable_key, current_revision_id, editorial_state, archived_at)
    VALUES ('term-subject', 'subject.hero', NULL, 'APPROVED', NULL)`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO term_revisions
    (id, term_id, revision_no, title, title_locale, definition, created_at)
    VALUES ('term-subject:v1', 'term-subject', 1, '主角', 'zh', '', ?)`,
    )
    .run(createdAt);
  database.db
    .prepare(
      `UPDATE terms SET current_revision_id = 'term-subject:v1'
    WHERE id = 'term-subject'`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO term_localizations
      (id, term_revision_id, locale, title, definition)
      VALUES ('term-subject:v1:en', 'term-subject:v1', 'en', 'hero', '')`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO term_context_profiles(id, term_id, stable_key, created_at)
      VALUES ('term-subject:context:legacy', 'term-subject', 'general.default', ?)`,
    )
    .run(createdAt);
  database.db
    .prepare(
      `INSERT INTO term_context_profile_revisions
      (id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at)
      VALUES ('term-subject:context:legacy:v1', 'term-subject:context:legacy', 'term-subject:v1', '', '', ?)`,
    )
    .run(createdAt);
  database.db
    .prepare(
      `INSERT INTO term_expressions
    (id, term_revision_id, context_profile_revision_id, model_key, locale, positive_expression, negative_expression)
    VALUES
      ('expression:model-a:v1', 'term-subject:v1', 'term-subject:context:legacy:v1', 'model-a', 'en', 'alpha rendering', ''),
      ('expression:model-b:v1', 'term-subject:v1', 'term-subject:context:legacy:v1', 'model-b', 'en', 'beta rendering', 'flat lighting')`,
    )
    .run();

  database.registerPack({
    id: 'pack-subject',
    kind: 'CONTENT',
    displayName: 'Subject pack',
    contentKinds: ['KNOWLEDGE'],
  });
  database.registerPackRelease({
    id: 'pack-subject:0.1.0',
    packId: 'pack-subject',
    version: '0.1.0',
    manifestVersion: 1,
    contentHash: 'sha256:pack-subject',
    manifest: { version: '0.1.0' },
    items: [
      {
        id: 'pack-subject:item:term-subject',
        itemKey: 'term.subject.hero',
        objectType: 'TERM_REVISION',
        objectRevisionId: 'term-subject:v1',
        contentHash: 'sha256:term-subject-v1',
      },
    ],
  });
  database.linkPackReleaseItem({
    releaseItemId: 'pack-subject:item:term-subject',
    localObjectType: 'TERM',
    localObjectId: 'term-subject',
    localRevisionId: 'term-subject:v1',
    mappingKind: 'REUSED_IDENTICAL',
  });
}

function seedRecipe(database: ReturnType<typeof createTestLibrary>['database']) {
  const createdAt = '2026-07-30T00:00:00.000Z';
  database.db
    .prepare(
      `INSERT INTO word_palettes
    (id, pinned, created_at, updated_at, archived_at, deleted_at, current_revision_id)
    VALUES ('recipe-hero', 0, ?, ?, NULL, NULL, NULL)`,
    )
    .run(createdAt, createdAt);
  database.db
    .prepare(
      `INSERT INTO word_palette_revisions
    (id, palette_id, parent_revision_id, revision_no, name, name_locale,
     description, kind, content_hash, created_at)
    VALUES ('recipe-hero:v1', 'recipe-hero', NULL, 1, '主角配方', 'zh',
      '', 'PARAMETERIZED', 'sha256:recipe-hero-v1', ?)`,
    )
    .run(createdAt);
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_localizations
      (id, palette_revision_id, locale, name, description)
      VALUES ('recipe-hero:v1:en', 'recipe-hero:v1', 'en', 'Hero recipe', '')`,
    )
    .run();
  database.db
    .prepare(
      `UPDATE word_palettes SET current_revision_id = 'recipe-hero:v1'
    WHERE id = 'recipe-hero'`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_terms
    (id, palette_revision_id, term_id, sort_order)
    VALUES ('recipe-hero:v1:term', 'recipe-hero:v1', 'term-subject', 0)`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_parameters
    (id, palette_revision_id, stable_key, name, name_locale, required, sort_order)
    VALUES ('recipe-hero:v1:detail', 'recipe-hero:v1', 'detail', '细节', 'zh', 1, 0)`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_parameter_localizations
      (id, parameter_revision_id, locale, name)
      VALUES ('recipe-hero:v1:detail:en', 'recipe-hero:v1:detail', 'en', 'detail')`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_parameter_options
    (id, parameter_revision_id, value_key, label, label_locale, sort_order)
    VALUES ('recipe-hero:v1:detail:high', 'recipe-hero:v1:detail', 'high', '高', 'zh', 0)`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_option_localizations
      (id, option_id, locale, label)
      VALUES ('recipe-hero:v1:detail:high:en', 'recipe-hero:v1:detail:high', 'en', 'high')`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_option_contents
      (id, option_id, kind, term_id, prompt_fragment, negative_fragment, sort_order)
      VALUES ('recipe-hero:v1:detail:high:text', 'recipe-hero:v1:detail:high', 'TEXT', NULL,
        'detail level: intricate', '', 0)`,
    )
    .run();
  database.db
    .prepare(
      `INSERT INTO word_palette_revision_content_nodes
      (id, palette_revision_id, kind, term_id, parameter_revision_id, prompt_fragment, negative_fragment, sort_order)
      VALUES
        ('recipe-hero:v1:term-node', 'recipe-hero:v1', 'TERM', 'term-subject', NULL, '', '', 0),
        ('recipe-hero:v1:separator', 'recipe-hero:v1', 'TEXT', NULL, NULL, ', ', '', 1),
        ('recipe-hero:v1:slot', 'recipe-hero:v1', 'SLOT', NULL, 'recipe-hero:v1:detail', '', '', 2)`,
    )
    .run();
  database.registerPack({
    id: 'pack-recipe',
    kind: 'CONTENT',
    displayName: 'Recipe pack',
    contentKinds: ['RECIPE'],
  });
  database.registerPackRelease({
    id: 'pack-recipe:0.1.0',
    packId: 'pack-recipe',
    version: '0.1.0',
    manifestVersion: 1,
    contentHash: 'sha256:pack-recipe',
    manifest: { version: '0.1.0' },
    items: [
      {
        id: 'pack-recipe:item:recipe-hero',
        itemKey: 'recipe.hero',
        objectType: 'RECIPE_REVISION',
        objectRevisionId: 'recipe-hero:v1',
        contentHash: 'sha256:recipe-hero-v1',
      },
    ],
  });
  database.linkPackReleaseItem({
    releaseItemId: 'pack-recipe:item:recipe-hero',
    localObjectType: 'RECIPE',
    localObjectId: 'recipe-hero',
    localRevisionId: 'recipe-hero:v1',
    mappingKind: 'REUSED_IDENTICAL',
  });
}

function pendingPreparedModel(
  key: string,
  database: ReturnType<typeof createTestLibrary>['database'],
  received: GenerationInput[],
  snapshotWasFrozen: boolean[],
): GenerationModel {
  return {
    descriptor: descriptor(key),
    prepareExecution(runId, input) {
      received.push(input);
      return {
        requestSnapshot: {
          route: 'PROVIDER_ADAPTER',
          requestSchema: 'test-provider-request.v1',
          actualRequest: { runId, prompt: input.prompt, modelKey: key },
          clientRequestText: input.prompt,
        },
        execute(onStarted) {
          const count = database.db
            .prepare(
              `SELECT COUNT(*) AS count
            FROM execution_input_snapshots WHERE generation_run_id = ?`,
            )
            .get(runId) as { count: number };
          snapshotWasFrozen.push(count.count === 1);
          onStarted(vi.fn());
          return new Promise<never>(() => undefined);
        },
      };
    },
  };
}

describe('prompt and execution snapshots', () => {
  it('preserves frozen flat-input references and resolved negative prompt facts', () => {
    const library = createTestLibrary('aibd-flat-snapshot-resolution-');
    try {
      const resolved = library.database.resolveGenerationInput(
        {
          seriesId: 'series-flat-input',
          title: '',
          manualPrompt: 'renderer value must not win',
          prompt: 'renderer prompt must not win',
          changeSummary: '',
          referenceAssetIds: ['asset-from-reference-binding'],
          termPromptLocale: 'en',
          termIds: [],
          wordPaletteReferences: [],
          modelKey: 'model-a',
          canvasPresetKey: null,
          width: null,
          height: null,
          quality: 'low',
        },
        {
          userInstruction: 'frozen user instruction',
          directTermPromptLocale: 'en',
          directTerms: [],
          recipes: [],
          directReferences: [
            {
              assetId: 'asset-from-reference-binding',
              contentHash: 'sha256:asset-from-reference-binding',
              role: 'DIRECT_REFERENCE',
            },
          ],
          flatPrompt: 'frozen flattened input',
          flatNegativePrompt: 'frozen negative input',
          flatResolvedPrompt: {
            commonExpression: 'frozen resolved prompt',
            negativeExpression: 'frozen resolved negative',
          },
        },
      );

      expect(resolved.prompt).toBe('frozen resolved prompt');
      expect(resolved.resolvedPrompt?.negativeExpression).toBe('frozen resolved negative');
      expect(resolved.referenceAssetIds).toEqual(['asset-from-reference-binding']);
    } finally {
      library.cleanup();
    }
  });

  it('keeps one recipe use with nested term facts in the model-neutral snapshot', () => {
    const library = createTestLibrary('aibd-recipe-snapshot-');
    try {
      seedModelSpecificTerm(library.database);
      seedRecipe(library.database);
      const common = library.database.capturePromptCommonInput({
        manualPrompt: 'shared intent',
        referenceAssetIds: [],
        termIds: [],
        wordPaletteReferences: [
          {
            paletteId: 'recipe-hero',
            paletteRevisionId: 'recipe-hero:v1',
            parameterValues: { detail: 'high' },
            promptLocale: 'en',
          },
        ],
      });

      expect(common.directTerms).toEqual([]);
      expect(common.recipes).toEqual([
        expect.objectContaining({
          useId: 'recipe-hero:recipe-hero:v1',
          paletteId: 'recipe-hero',
          paletteRevisionId: 'recipe-hero:v1',
          name: '主角配方',
          nameLocale: 'zh',
          localizations: [{ locale: 'en', name: 'Hero recipe' }],
          terms: [
            expect.objectContaining({
              termId: 'term-subject',
              termRevisionId: 'term-subject:v1',
            }),
          ],
          parameters: [
            {
              parameterRevisionId: 'recipe-hero:v1:detail',
              stableKey: 'detail',
              optionId: 'recipe-hero:v1:detail:high',
              valueKey: 'high',
            },
          ],
          packSources: [
            {
              packId: 'pack-recipe',
              packReleaseId: 'pack-recipe:0.1.0',
              packReleaseItemId: 'pack-recipe:item:recipe-hero',
            },
          ],
        }),
      ]);
      const resolved = library.database.resolveGenerationInput(
        {
          seriesId: null,
          title: '',
          manualPrompt: 'ignored renderer input',
          prompt: 'ignored renderer prompt',
          changeSummary: '',
          referenceAssetIds: [],
          termIds: [],
          wordPaletteReferences: [],
          modelKey: 'model-a',
          canvasPresetKey: null,
          width: null,
          height: null,
          quality: 'low',
        },
        common,
      );
      expect(resolved.prompt).toBe('shared intent, alpha rendering, detail level: intricate');
      expect(resolved.resolvedPrompt?.frozenReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'RECIPE_REVISION', stableId: 'recipe-hero', revisionId: 'recipe-hero:v1' }),
          expect.objectContaining({ kind: 'TERM_EXPRESSION_REVISION', stableId: 'term-subject' }),
        ]),
      );
    } finally {
      library.cleanup();
    }
  });

  it('reuses a recipe snapshot without mutating its frozen labels', () => {
    const library = createTestLibrary('aibd-recipe-label-compatibility-');
    try {
      seedModelSpecificTerm(library.database);
      seedRecipe(library.database);
      const base: GenerationInput = {
        seriesId: null,
        title: '历史配方',
        manualPrompt: 'shared intent',
        prompt: 'renderer projection',
        changeSummary: '',
        referenceAssetIds: [],
        termIds: [],
        wordPaletteReferences: [
          {
            paletteId: 'recipe-hero',
            paletteRevisionId: 'recipe-hero:v1',
            parameterValues: { detail: 'high' },
            promptLocale: 'en',
          },
        ],
        modelKey: 'model-a',
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      };
      const currentCommon = library.database.capturePromptCommonInput(base);
      const frozenCommon = {
        ...currentCommon,
        recipes: currentCommon.recipes.map((recipe) => ({
          useId: recipe.useId,
          paletteId: recipe.paletteId,
          paletteRevisionId: recipe.paletteRevisionId,
          name: recipe.name,
          nameLocale: recipe.nameLocale,
          localizations: recipe.localizations,
          promptLocale: recipe.promptLocale,
          parameterValues: recipe.parameterValues,
          terms: recipe.terms,
          parameters: recipe.parameters,
          contentNodes: recipe.contentNodes,
          references: recipe.references,
          packSources: recipe.packSources,
        })),
      };
      const firstInput = library.database.resolveGenerationInput(base, frozenCommon);
      const first = library.database.prepareGeneration(firstInput, frozenCommon);
      const secondInput = library.database.resolveGenerationInput(
        {
          ...base,
          seriesId: first.seriesId,
        },
        currentCommon,
      );
      const second = library.database.prepareGeneration(secondInput, currentCommon);

      expect(second.versionId).toBe(first.versionId);
      expect(library.database.getPromptCommonInput(first.versionId).recipes[0]).toMatchObject({
        name: '主角配方',
        nameLocale: 'zh',
        localizations: [{ locale: 'en', name: 'Hero recipe' }],
      });
    } finally {
      library.cleanup();
    }
  });

  it('versions direct-term locale and ignores mutable run locale during execution and retry', () => {
    const library = createTestLibrary('aibd-prompt-locale-snapshot-');
    try {
      seedModelSpecificTerm(library.database);
      const base: GenerationInput = {
        seriesId: null,
        title: '语言快照',
        manualPrompt: 'shared intent',
        prompt: 'renderer text',
        changeSummary: '',
        referenceAssetIds: [],
        termPromptLocale: 'en',
        termIds: ['term-subject'],
        wordPaletteReferences: [],
        modelKey: 'model-a',
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      };
      const commonEn = library.database.capturePromptCommonInput(base);
      expect(commonEn.directTermPromptLocale).toBe('en');

      const mutableZhInput = library.database.resolveGenerationInput(
        {
          ...base,
          termPromptLocale: 'zh',
        },
        commonEn,
      );
      expect(mutableZhInput.termPromptLocale).toBe('en');
      expect(mutableZhInput.resolvedPrompt?.effectiveTerms[0].label).toBe('hero');
      const preparedEn = library.database.prepareGeneration(mutableZhInput, commonEn);
      library.database.freezeGenerationExecution(
        preparedEn.runId,
        { ...mutableZhInput, termPromptLocale: 'zh' },
        commonEn,
        descriptor('model-a'),
        {
          route: 'PROVIDER_ADAPTER',
          requestSchema: 'locale-test.v1',
          actualRequest: { prompt: mutableZhInput.prompt },
          clientRequestText: mutableZhInput.prompt,
        },
      );
      const enRun = library.database.getWorkbench().series[0].versions[0].runs[0];
      expect(enRun.executionInputSnapshot?.commonInput.promptInput.directTermPromptLocale).toBe('en');
      expect(enRun.executionInputSnapshot?.commonInput.resolvedPrompt.effectiveTerms[0].label).toBe('hero');

      library.database.markRun(preparedEn.runId, 'FAILED', 'test retry');
      library.database.db
        .prepare(
          `UPDATE prompt_versions SET term_prompt_locale = 'zh'
        WHERE id = ?`,
        )
        .run(preparedEn.versionId);
      const retry = library.database.prepareGenerationRetry(preparedEn.runId);
      expect(retry.input.termPromptLocale).toBe('zh');
      const retryCommon = library.database.getPromptCommonInput(retry.versionId);
      const retryResolved = library.database.resolveGenerationInput(retry.input, retryCommon);
      expect(retryCommon.directTermPromptLocale).toBe('en');
      expect(retryResolved.termPromptLocale).toBe('en');
      expect(retryResolved.resolvedPrompt?.effectiveTerms[0].label).toBe('hero');

      const zhBase = { ...base, seriesId: preparedEn.seriesId, termPromptLocale: 'zh' as const };
      const commonZh = library.database.capturePromptCommonInput(zhBase);
      const resolvedZh = library.database.resolveGenerationInput(zhBase, commonZh);
      const preparedZh = library.database.prepareGeneration(resolvedZh, commonZh);
      expect(commonZh.directTermPromptLocale).toBe('zh');
      expect(resolvedZh.resolvedPrompt?.effectiveTerms[0].label).toBe('主角');
      expect(preparedZh.versionId).not.toBe(preparedEn.versionId);
      expect(
        library.database.db
          .prepare(
            `SELECT COUNT(*) AS count FROM prompt_versions
        WHERE series_id = ?`,
          )
          .get(preparedEn.seriesId),
      ).toEqual({ count: 2 });
    } finally {
      library.cleanup();
    }
  });

  it('shares one model-neutral PromptVersion while freezing each model request before submission', async () => {
    const library = createTestLibrary('aibd-execution-snapshot-');
    try {
      seedModelSpecificTerm(library.database);
      const received: GenerationInput[] = [];
      const snapshotWasFrozen: boolean[] = [];
      const coordinator = new GenerationCoordinator(
        library.database,
        new GenerationModelRegistry([
          pendingPreparedModel('model-a', library.database, received, snapshotWasFrozen),
          pendingPreparedModel('model-b', library.database, received, snapshotWasFrozen),
        ]),
      );

      const started = coordinator.startBatch({
        input: {
          seriesId: null,
          title: '执行快照',
          manualPrompt: '  shared intent  ',
          prompt: 'renderer supplied model-a text',
          changeSummary: '',
          referenceAssetIds: [],
          termPromptLocale: 'en',
          termIds: ['term-subject'],
          wordPaletteReferences: [],
          canvasPresetKey: 'square_1_1',
          width: 1024,
          height: 1024,
          quality: 'low',
        },
        targets: [
          { modelKey: 'model-a', count: 1, quality: 'low' },
          { modelKey: 'model-b', count: 1, quality: 'high' },
        ],
      });

      await vi.waitFor(() => expect(snapshotWasFrozen).toEqual([true, true]));
      expect(received.map((item) => [item.modelKey, item.prompt, item.resolvedPrompt?.negativeExpression])).toEqual([
        ['model-a', 'shared intent, alpha rendering', ''],
        ['model-b', 'shared intent, beta rendering', 'flat lighting'],
      ]);
      expect(
        library.database.db
          .prepare(
            `SELECT COUNT(*) AS count FROM prompt_versions
        WHERE series_id = ?`,
          )
          .get(started.seriesId),
      ).toEqual({ count: 1 });

      const version = library.database.getWorkbench().series[0].versions[0];
      expect(version.id).toBe(started.versionId);
      expect(version.promptInputSnapshot).toMatchObject({
        sourceKind: 'COMPOSED',
        commonInput: {
          userInstruction: '  shared intent  ',
          directTerms: [
            {
              termId: 'term-subject',
              termRevisionId: 'term-subject:v1',
              packSources: [
                {
                  packId: 'pack-subject',
                  packReleaseId: 'pack-subject:0.1.0',
                  packReleaseItemId: 'pack-subject:item:term-subject',
                },
              ],
            },
          ],
        },
      });
      const runByModel = new Map(version.runs.map((run) => [run.modelKey, run]));
      expect(runByModel.get('model-a')?.executionInputSnapshot).toMatchObject({
        route: 'PROVIDER_ADAPTER',
        requestSchema: 'test-provider-request.v1',
        commonInput: { resolvedPrompt: { commonExpression: 'shared intent, alpha rendering' } },
        actualRequest: { prompt: 'shared intent, alpha rendering', modelKey: 'model-a' },
        clientRequestText: 'shared intent, alpha rendering',
      });
      expect(runByModel.get('model-b')?.executionInputSnapshot).toMatchObject({
        commonInput: {
          resolvedPrompt: {
            commonExpression: 'shared intent, beta rendering',
            negativeExpression: 'flat lighting',
          },
        },
        actualRequest: { prompt: 'shared intent, beta rendering', modelKey: 'model-b' },
      });
      expect(runByModel.get('model-a')?.modelSnapshot?.descriptor).toMatchObject({
        key: 'model-a',
        providerKey: 'test',
        modelId: 'model-a',
      });

      expect(() =>
        library.database.db
          .prepare(
            `UPDATE prompt_input_snapshots
        SET user_instruction = 'changed' WHERE prompt_version_id = ?`,
          )
          .run(started.versionId),
      ).toThrow('Prompt input snapshots are immutable');
      expect(() =>
        library.database.db
          .prepare(
            `DELETE FROM execution_input_snapshots
        WHERE generation_run_id = ?`,
          )
          .run(started.runIds[0]),
      ).toThrow('Execution input snapshots are immutable');
      coordinator.dispose();
    } finally {
      library.cleanup();
    }
  });

  it('captures the exact Codex CLI outer request without calling it a provider-internal prompt', async () => {
    const request = buildCodexImageOuterRequest(
      'codex-test',
      'C:\\space\\temp\\generation\\run-1',
      'C:\\space\\temp\\generation\\run-1\\result.png',
      { prompt: 'a precise visual', quality: 'high', width: 1024, height: 1536 },
      ['references/01.png'],
    );
    const model = new CodexImageModel({
      cachedHealth: { state: 'ready', version: 'test', authenticated: true, message: 'ready' },
      prepareGeneration: async () => ({
        request,
        execute: async () => 'result.png',
      }),
    } as unknown as CodexAdapter);
    const prepared = await model.prepareExecution('run-1', {
      seriesId: null,
      title: '',
      manualPrompt: 'a precise visual',
      prompt: 'a precise visual',
      changeSummary: '',
      referenceAssetIds: [],
      termIds: [],
      wordPaletteReferences: [],
      modelKey: 'gpt-image-2',
      canvasPresetKey: null,
      width: 1024,
      height: 1536,
      quality: 'high',
    });

    expect(prepared.requestSnapshot).toMatchObject({
      route: 'CODEX_CLI',
      requestSchema: 'codex-cli-imagegen.v1',
      actualRequest: {
        command: 'codex-test',
        arguments: expect.arrayContaining(['exec', '--sandbox', 'workspace-write']),
        cwd: 'C:\\space\\temp\\generation\\run-1',
        expectedOutputPath: 'C:\\space\\temp\\generation\\run-1\\result.png',
      },
    });
    expect(request.stdin).toContain('<visual_spec>\na precise visual\n</visual_spec>');
    expect(request.stdin).toContain(
      'Use these local reference images when invoking the image tool: references/01.png.',
    );
    expect(prepared.requestSnapshot.clientRequestText).toBe(request.stdin);
  });

  it('rejects credential-bearing prepared requests before model execution', async () => {
    const library = createTestLibrary('aibd-execution-secret-');
    try {
      const execute = vi.fn(() => new Promise<never>(() => undefined));
      const model: GenerationModel = {
        descriptor: descriptor('model-secret'),
        prepareExecution: (runId) => ({
          requestSnapshot: {
            route: 'PROVIDER_ADAPTER',
            requestSchema: 'unsafe-request.v1',
            actualRequest: { runId, headers: { authorization: 'Bearer must-not-persist' } },
          },
          execute,
        }),
      };
      const coordinator = new GenerationCoordinator(library.database, new GenerationModelRegistry([model]));
      const started = coordinator.start({
        seriesId: null,
        title: '密钥拒绝',
        manualPrompt: 'portrait',
        prompt: 'portrait',
        changeSummary: '',
        referenceAssetIds: [],
        termIds: [],
        wordPaletteReferences: [],
        modelKey: 'model-secret',
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      });

      await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
      expect(execute).not.toHaveBeenCalled();
      expect(
        library.database.db
          .prepare(
            `SELECT status, error_message FROM generation_runs
        WHERE id = ?`,
          )
          .get(started.runId),
      ).toEqual({
        status: 'FAILED',
        error_message: expect.stringContaining('credential field'),
      });
      expect(
        library.database.db
          .prepare(
            `SELECT COUNT(*) AS count FROM execution_input_snapshots
        WHERE generation_run_id = ?`,
          )
          .get(started.runId),
      ).toEqual({ count: 0 });
      expect(
        library.database.db
          .prepare(
            `SELECT source_kind, user_instruction FROM prompt_input_snapshots
        WHERE prompt_version_id = ?`,
          )
          .get(started.versionId),
      ).toEqual({
        source_kind: 'COMPOSED',
        user_instruction: 'portrait',
      });
      const promptInput = library.database.getPromptCommonInput(started.versionId);
      expect(promptInput).toMatchObject({ userInstruction: 'portrait' });
      expect(promptInput).not.toHaveProperty('legacyFlattenedPrompt');
    } finally {
      library.cleanup();
    }
  });
});
