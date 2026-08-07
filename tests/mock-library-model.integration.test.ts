import { describe, expect, it, vi } from 'vitest';
import type { GenerationInput } from '../src/shared/contracts';
import { GenerationCoordinator } from '../src/main/generation';
import {
  GenerationModelRegistry,
  InternalLibraryRandomModel,
  internalLibraryRandomModelKey,
  type GenerationModel,
} from '../src/main/generation-models';
import { createTestLibrary } from './support/test-library';

const input: GenerationInput = {
  seriesId: null,
  title: '挡板测试',
  manualPrompt: '这个输入不会影响挡板结果',
  prompt: '这个输入不会影响挡板结果',
  changeSummary: '',
  referenceAssetIds: [],
  termPromptLocale: 'zh',
  termIds: [],
  wordPaletteReferences: [],
  modelKey: internalLibraryRandomModelKey,
  canvasPresetKey: 'square_1_1',
  width: 1024,
  height: 1024,
  quality: 'low',
};

describe('internal library random model', () => {
  it('switches to the internal model and records a replayed material as a distinct traced result', async () => {
    const library = createTestLibrary('aibd-mock-model-');
    try {
      library.importReference('first.png', 1);
      library.importReference('second.png', 2);
      const replaySources = library.database.listGenerationReplaySources();
      expect(replaySources).toHaveLength(2);

      const productionPrepare = vi.fn<GenerationModel['prepareExecution']>(async () => {
        throw new Error('Production model must not be called');
      });
      const registry = new GenerationModelRegistry([
        {
          descriptor: {
            key: 'gpt-image-2',
            name: 'GPT Image 2',
            provider: 'Test',
            providerKey: 'test',
            modelId: 'gpt-image-2',
            state: 'READY',
            availabilityReason: null,
            releaseStage: 'STABLE',
            internal: false,
            maxReferenceImages: 0,
            capabilities: ['GENERATE'],
            qualityMode: 'SELECTABLE',
            supportedQualities: ['low', 'medium', 'high'],
          },
          prepareExecution: productionPrepare,
        },
        new InternalLibraryRandomModel(library.database, () => 0),
      ]);
      const coordinator = new GenerationCoordinator(library.database, registry);

      const started = coordinator.start(input);
      await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));

      expect(registry.list().map((model) => model.key)).toEqual(['gpt-image-2', internalLibraryRandomModelKey]);
      expect(productionPrepare).not.toHaveBeenCalled();
      const run = library.database.db
        .prepare(
          `SELECT model_key, status, result_asset_id
        FROM generation_runs WHERE id = ?`,
        )
        .get(started.runId) as {
        model_key: string;
        status: string;
        result_asset_id: string;
      };
      expect(run).toMatchObject({ model_key: internalLibraryRandomModelKey, status: 'SUCCEEDED' });
      expect(run.result_asset_id).not.toBe(replaySources[0]);

      const source = library.database.db
        .prepare('SELECT object_hash FROM image_assets WHERE id = ?')
        .get(replaySources[0]) as { object_hash: string };
      const result = library.database.db
        .prepare(
          `SELECT kind, origin_type, object_hash
        FROM image_assets WHERE id = ?`,
        )
        .get(run.result_asset_id) as {
        kind: string;
        origin_type: string;
        object_hash: string;
      };
      expect(result).toEqual({ kind: 'GENERATED', origin_type: 'GENERATION', object_hash: source.object_hash });
      expect(
        library.database.db
          .prepare(
            `SELECT source_asset_id, relation_type, generation_run_id
        FROM asset_derivations WHERE child_asset_id = ?`,
          )
          .get(run.result_asset_id),
      ).toEqual({
        source_asset_id: replaySources[0],
        relation_type: 'MODEL_REPLAY',
        generation_run_id: started.runId,
      });
      expect(library.database.getWorkbench().series[0].versions[0].runs[0].derivation).toEqual({
        sourceAssetId: replaySources[0],
        relationType: 'MODEL_REPLAY',
      });
    } finally {
      library.cleanup();
    }
  });
});
