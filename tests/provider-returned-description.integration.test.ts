import { describe, expect, it, vi } from 'vitest';
import type { GenerationModelDto } from '../src/shared/contracts';
import { GenerationCoordinator } from '../src/main/generation';
import { GenerationModelRegistry, type GenerationModel } from '../src/main/generation-models';
import { createTestLibrary } from './support/test-library';

const onePixelPng = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

function descriptor(): GenerationModelDto {
  return {
    key: 'provider-description-model',
    name: 'Provider description model',
    provider: 'Test provider',
    providerKey: 'test-provider',
    modelId: 'test-model',
    state: 'READY',
    availabilityReason: null,
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: 1,
    capabilities: ['GENERATE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
  };
}

describe('provider-returned descriptions', () => {
  it('persists only explicit response fields and exposes them as immutable run facts', async () => {
    const library = createTestLibrary('aibd-provider-description-');
    try {
      const source = library.database.importCreatorReferences({
        context: { seriesId: null, versionId: null, title: '', source: 'UPLOAD' },
        items: [{ id: 'source', name: 'source.png', mimeType: 'image/png', bytes: onePixelPng }],
      })[0];
      const model: GenerationModel = {
        descriptor: descriptor(),
        prepareExecution(runId, input) {
          return {
            requestSnapshot: {
              route: 'PROVIDER_ADAPTER',
              requestSchema: 'test-provider.v1',
              actualRequest: { runId, prompt: input.prompt },
              clientRequestText: input.prompt,
            },
            async execute(onStarted) {
              onStarted();
              return {
                kind: 'LIBRARY_ASSET' as const,
                sourceAssetId: source.id,
                providerReturnedDescriptions: [
                  {
                    fieldName: 'revised_prompt',
                    rawValue: 'provider revised description',
                    interpretation: 'provider supplied revised prompt field',
                    scopeKind: 'OUTPUT' as const,
                    outputOrdinal: 0,
                  },
                ],
              };
            },
          };
        },
      };
      const coordinator = new GenerationCoordinator(library.database, new GenerationModelRegistry([model]));
      const started = coordinator.start({
        seriesId: null,
        title: '返回描述',
        manualPrompt: 'original instruction',
        prompt: 'renderer projection',
        changeSummary: '',
        referenceAssetIds: [],
        termIds: [],
        wordPaletteReferences: [],
        modelKey: model.descriptor.key,
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      });

      await vi.waitFor(() => expect(coordinator.tasks).toEqual([]));
      const run = library.database
        .getWorkbench()
        .series.flatMap((series) => series.versions)
        .flatMap((version) => version.runs)
        .find((item) => item.id === started.runId);
      expect(run?.providerReturnedDescriptions).toEqual([
        expect.objectContaining({
          fieldName: 'revised_prompt',
          rawValue: 'provider revised description',
          interpretation: 'provider supplied revised prompt field',
          scopeKind: 'OUTPUT',
          outputOrdinal: 0,
        }),
      ]);

      const descriptionId = run!.providerReturnedDescriptions![0].id;
      expect(() =>
        library.database.db
          .prepare(
            `UPDATE provider_returned_descriptions
        SET raw_value = 'changed' WHERE id = ?`,
          )
          .run(descriptionId),
      ).toThrow('provider returned descriptions are immutable');
      expect(() =>
        library.database.db
          .prepare(
            `DELETE FROM provider_returned_descriptions
        WHERE id = ?`,
          )
          .run(descriptionId),
      ).toThrow('provider returned descriptions are immutable');
      coordinator.dispose();
    } finally {
      library.cleanup();
    }
  });

  it('keeps the response layer absent when the provider supplied no typed description', () => {
    const library = createTestLibrary('aibd-provider-description-empty-');
    try {
      expect(library.database.db.prepare('SELECT COUNT(*) AS count FROM provider_returned_descriptions').get()).toEqual(
        { count: 0 },
      );
    } finally {
      library.cleanup();
    }
  });
});
