import { describe, expect, it } from 'vitest';
import { createTestLibrary } from './support/test-library';

const onePixelPng = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

function generationInput(seriesId: string | null, prompt: string) {
  return {
    seriesId,
    title: '导入关系',
    manualPrompt: prompt,
    prompt,
    changeSummary: prompt,
    referenceAssetIds: [],
    termIds: [],
    wordPaletteReferences: [],
    modelKey: 'gpt-image-2',
    canvasPresetKey: null,
    width: null,
    height: null,
    quality: 'low' as const,
  };
}

describe('imported creation output Prompt relationship', () => {
  it('can be explicitly relinked to an exact PromptVersion without inventing a run', () => {
    const library = createTestLibrary('aibd-imported-output-link-');
    try {
      const first = library.database.prepareGeneration(generationInput(null, 'first input'));
      const second = library.database.prepareGeneration(generationInput(first.seriesId, 'second input'));
      const imported = library.database.importCreatorOutputs({
        context: {
          seriesId: first.seriesId,
          versionId: first.versionId,
          title: '',
          source: 'UPLOAD',
        },
        items: [{ id: 'one-pixel', name: 'one.png', mimeType: 'image/png', bytes: onePixelPng }],
      }).importedOutputs[0];

      const updated = library.database.updateImportedCreationOutput({
        outputId: imported.id,
        promptVersionId: second.versionId,
        displayName: imported.displayName,
        note: '',
        sourceUrl: '',
        aiGeneratedStatus: 'YES',
        comparisonRole: 'UNKNOWN',
        modelKey: null,
        modelName: '',
        modelProvider: '',
        modelVersion: '',
        generationTextType: 'EXACT_PROMPT',
        generationText: 'external declared prompt',
      });

      expect(updated.promptVersionId).toBe(second.versionId);
      expect(
        library.database.db
          .prepare(
            `SELECT COUNT(*) AS count FROM generation_runs
        WHERE result_asset_id = ?`,
          )
          .get(imported.imageAssetId),
      ).toEqual({ count: 0 });
      expect(() =>
        library.database.updateImportedCreationOutput({
          ...updated,
          outputId: imported.id,
          promptVersionId: 'another-series-version',
        }),
      ).toThrow('Prompt version does not belong');
    } finally {
      library.cleanup();
    }
  });
});
