import { describe, expect, it } from 'vitest';
import type {
  GenerationModelDto,
  ImportedCreationOutputDto,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
} from '../src/shared/contracts';
import {
  collectVisibleComparisonModelKeys,
  comparisonImportedPromptRowId,
  comparisonVersionReferenceNames,
  comparisonVersionGroupRowId,
  diffPromptText,
  filterKnownComparisonModels,
  groupEquivalentPromptVersions,
  importedPromptPlacement,
  linkedPromptVersion,
  type PromptDiffPart,
} from '../src/renderer/components/creator/generationComparisonUtils';

function model(key: string, state: GenerationModelDto['state'] = 'READY'): GenerationModelDto {
  return {
    key,
    name: key,
    provider: 'test',
    providerKey: 'test',
    modelId: key,
    state,
    availabilityReason: state === 'READY' ? null : 'HISTORICAL',
    releaseStage: 'STABLE',
    internal: false,
    maxReferenceImages: null,
    capabilities: ['GENERATE'],
    qualityMode: 'SELECTABLE',
    supportedQualities: ['low', 'medium', 'high'],
  };
}

function sourceText(parts: PromptDiffPart[]) {
  return parts
    .filter((part) => part.type !== 'added')
    .map((part) => part.value)
    .join('');
}

function resultText(parts: PromptDiffPart[]) {
  return parts
    .filter((part) => part.type !== 'removed')
    .map((part) => part.value)
    .join('');
}

function version(versionNo: number, overrides: Partial<PromptVersionDto> = {}): PromptVersionDto {
  const value: PromptVersionDto = {
    id: `version-${versionNo}`,
    parentVersionId: versionNo > 1 ? `version-${versionNo - 1}` : null,
    versionNo,
    manualPrompt: 'portrait',
    finalPrompt: 'portrait, natural light',
    isStructured: true,
    termPromptLocale: 'en',
    termIds: ['natural-light'],
    wordPaletteReferences: [],
    referenceAssets: [],
    changeSummary: '',
    createdAt: `2026-07-${String(versionNo).padStart(2, '0')}T00:00:00.000Z`,
    runs: [],
    promptInputSnapshot: promptInputSnapshot('placeholder'),
    ...overrides,
  };
  if (!overrides.promptInputSnapshot) {
    value.promptInputSnapshot = promptInputSnapshot(
      JSON.stringify({
        manualPrompt: value.manualPrompt.trim(),
        termPromptLocale: value.termPromptLocale,
        termIds: value.termIds,
        recipes: value.wordPaletteReferences,
        referenceAssetIds: value.referenceAssets.map((asset) => asset.id),
      }),
    );
  }
  return value;
}

function promptInputSnapshot(contentHash: string) {
  return {
    id: `snapshot-${contentHash}`,
    sourceKind: 'COMPOSED' as const,
    commonInput: {
      userInstruction: 'portrait',
      directTermPromptLocale: 'en' as const,
      directTerms: [],
      recipes: [],
      directReferences: [],
    },
    contentHash,
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}

function importedOutput(overrides: Partial<ImportedCreationOutputDto> = {}): ImportedCreationOutputDto {
  return {
    id: 'import-1',
    batchId: 'batch-1',
    seriesId: 'series-1',
    promptVersionId: 'version-1',
    imageAssetId: 'asset-1',
    sourceType: 'UPLOAD',
    originalName: 'image.png',
    displayName: 'image.png',
    note: '',
    sourceUrl: '',
    aiGeneratedStatus: 'YES',
    comparisonRole: 'MODEL',
    modelKey: 'gpt-image-2',
    modelName: 'GPT Image 2',
    modelProvider: 'OpenAI',
    modelVersion: '',
    generationTextType: 'EXACT_PROMPT',
    generationText: 'portrait, natural light',
    provenanceConfidence: 'DECLARED',
    createdAt: '2026-07-28T00:00:00.000Z',
    asset: {
      id: 'asset-1',
      kind: 'REFERENCE',
      width: 1024,
      height: 1536,
      mimeType: 'image/png',
      mediaUrl: 'aibd-media://asset-1',
      createdAt: '2026-07-28T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('prompt comparison diff', () => {
  it('marks an initial prompt as added', () => {
    expect(diffPromptText('', 'portrait with soft light')).toEqual([
      { type: 'added', value: 'portrait with soft light' },
    ]);
  });

  it('shows a word insertion without losing its whitespace', () => {
    expect(diffPromptText('portrait, soft light', 'portrait, dramatic soft light')).toEqual([
      { type: 'equal', value: 'portrait, ' },
      { type: 'added', value: 'dramatic ' },
      { type: 'equal', value: 'soft light' },
    ]);
  });

  it('shows removed and added words for a replacement', () => {
    expect(diffPromptText('portrait, blue dress', 'portrait, red dress')).toEqual([
      { type: 'equal', value: 'portrait, ' },
      { type: 'removed', value: 'blue ' },
      { type: 'added', value: 'red ' },
      { type: 'equal', value: 'dress' },
    ]);
  });

  it('keeps multiple separated edits distinct', () => {
    expect(diffPromptText('a cat under soft daylight', 'a dog under crisp moonlight')).toEqual([
      { type: 'equal', value: 'a ' },
      { type: 'removed', value: 'cat ' },
      { type: 'added', value: 'dog ' },
      { type: 'equal', value: 'under ' },
      { type: 'removed', value: 'soft daylight' },
      { type: 'added', value: 'crisp moonlight' },
    ]);
  });

  it('returns one equal part for an unchanged prompt', () => {
    expect(diffPromptText('portrait\n  with exact spacing', 'portrait\n  with exact spacing')).toEqual([
      { type: 'equal', value: 'portrait\n  with exact spacing' },
    ]);
  });

  it('falls back safely for very long prompts while preserving both originals', () => {
    const common = 'shared token, '.repeat(5_000);
    const previous = `${common}warm portrait`;
    const next = `${common}cool portrait`;
    const parts = diffPromptText(previous, next);

    expect(sourceText(parts)).toBe(previous);
    expect(resultText(parts)).toBe(next);
    expect(parts).toHaveLength(4);
    expect(parts.map((part) => part.type)).toEqual(['equal', 'removed', 'added', 'equal']);
  });
});

describe('comparison model visibility', () => {
  it('shows successful, active, and explicitly added models without treating failed runs as results', () => {
    const run = (modelKey: string, hasAsset: boolean) => ({
      id: `run-${modelKey}`,
      modelKey,
      status: hasAsset ? ('SUCCEEDED' as const) : ('FAILED' as const),
      canvasPresetKey: null,
      width: 1024,
      height: 1536,
      quality: 'low' as const,
      asset: hasAsset
        ? {
            id: `asset-${modelKey}`,
            createdAt: '2026-07-28T00:00:00.000Z',
            kind: 'GENERATED' as const,
            width: 1024,
            height: 1536,
            mimeType: 'image/png',
            mediaUrl: `aibd-media://${modelKey}`,
          }
        : null,
      derivation: null,
      errorMessage: null,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(
      collectVisibleComparisonModelKeys(
        [run('successful', true), run('failed-only', false)],
        ['running'],
        ['explicit'],
      ),
    ).toEqual(['successful', 'running', 'explicit']);
  });

  it('filters out READY models without an automatic or explicit visible key', () => {
    const models = [model('generated-model'), model('empty-ready-model'), model('explicit-model')];
    const visibleKeys = new Set(['generated-model', 'explicit-model']);

    expect(filterKnownComparisonModels(models, visibleKeys).map((item) => item.key)).toEqual([
      'generated-model',
      'explicit-model',
    ]);
  });

  it('retains a supplied unavailable descriptor when its historical key is visible', () => {
    const unavailable = model('retired-model', 'UNAVAILABLE');

    expect(filterKnownComparisonModels([unavailable], new Set(['retired-model']))).toEqual([unavailable]);
  });
});

describe('comparison prompt grouping', () => {
  it('keeps a deleted recipe as one frozen aggregate chip without exposing nested terms', () => {
    const historical = version(1, {
      termIds: [],
      wordPaletteReferences: [
        {
          paletteId: 'recipe-hero',
          paletteRevisionId: 'recipe-hero:v1',
          parameterValues: {},
          promptLocale: 'zh',
        },
      ],
      promptInputSnapshot: {
        ...promptInputSnapshot('recipe-history'),
        commonInput: {
          ...promptInputSnapshot('recipe-history').commonInput,
          recipes: [
            {
              useId: 'recipe-hero:recipe-hero:v1',
              paletteId: 'recipe-hero',
              paletteRevisionId: 'recipe-hero:v1',
              name: '主角级造型',
              nameLocale: 'zh',
              localizations: [{ locale: 'en', name: 'Hero styling' }],
              promptLocale: 'zh',
              parameterValues: {},
              terms: [{ termId: 'nested-detail', termRevisionId: 'nested-detail:v1' }],
              parameters: [],
              contentNodes: [
                {
                  id: 'nested-detail-node',
                  kind: 'TERM',
                  term: { termId: 'nested-detail', termRevisionId: 'nested-detail:v1' },
                },
              ],
              references: [],
            },
          ],
        },
      },
    });
    const nestedTerm = {
      id: 'nested-detail',
      stableKey: 'term.nested-detail',
      title: '内部细节词',
      titleLocale: 'zh',
      definition: '',
      aliases: [],
      localizations: [{ locale: 'en', title: 'Nested detail term', definition: '', aliases: [] }],
      editorialState: 'APPROVED',
      revisionNo: 1,
      termRevisionId: 'nested-detail:v1',
      modelExpressions: [],
      classificationIds: [],
      classifications: [],
      primaryDirectoryClassificationId: null,
      hasDraft: false,
      mediaPreview: { totalCount: 0, items: [] },
      metrics: {
        citationCount: 0,
        distinctPromptSeries: 0,
        positiveEvidence: 0,
        negativeEvidence: 0,
        pendingIssues: 0,
        lastValidatedAt: null,
      },
    } as TermListItem;
    const renamedCurrentPalette = {
      id: 'recipe-hero',
      revisions: [
        {
          id: 'recipe-hero:v1',
          name: '后来改名',
          nameLocale: 'zh',
          localizations: [{ locale: 'en', name: 'Renamed later', description: '' }],
        },
      ],
    } as unknown as WordPaletteDto;

    expect(comparisonVersionReferenceNames(historical, 'zh', [nestedTerm], [renamedCurrentPalette])).toEqual([
      '主角级造型',
    ]);
  });

  it('falls back to the stable recipe ID for a pre-name snapshot after deletion', () => {
    const historical = version(1, {
      termIds: [],
      wordPaletteReferences: [
        {
          paletteId: 'recipe-legacy',
          paletteRevisionId: 'recipe-legacy:v1',
          parameterValues: {},
          promptLocale: 'zh',
        },
      ],
    });

    expect(comparisonVersionReferenceNames(historical, 'zh', [], [])).toEqual(['recipe-legacy']);
  });

  it('keeps logical row IDs stable when equivalent versions or imported prompts are inserted', () => {
    const first = version(1);
    const duplicate = version(2);
    expect(comparisonVersionGroupRowId([first])).toBe(comparisonVersionGroupRowId([first, duplicate]));
    expect(comparisonImportedPromptRowId(' external   exact prompt ')).toBe(
      comparisonImportedPromptRowId('external exact prompt'),
    );
  });

  it('stacks equivalent historical versions into one prompt row', () => {
    const first = version(1);
    const duplicate = version(2);
    const changed = version(3, { manualPrompt: 'night portrait', finalPrompt: 'night portrait, natural light' });

    expect(
      groupEquivalentPromptVersions([changed, duplicate, first]).map((group) => group.map((item) => item.id)),
    ).toEqual([['version-1', 'version-2'], ['version-3']]);
  });

  it('keeps versions separate when their structured inputs differ', () => {
    const first = version(1);
    const changedTerms = version(2, { termIds: ['soft-light'] });
    const changedReference = version(3, {
      referenceAssets: [
        {
          id: 'reference-1',
          kind: 'REFERENCE',
          width: 100,
          height: 100,
          mimeType: 'image/png',
          mediaUrl: 'aibd-media://reference-1',
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    });

    expect(groupEquivalentPromptVersions([first, changedTerms, changedReference])).toHaveLength(3);
  });

  it('groups new versions by their frozen model-neutral input instead of a model-specific projection', () => {
    const first = version(1, {
      finalPrompt: 'model A projection',
      promptInputSnapshot: promptInputSnapshot('same-common-input'),
    });
    const second = version(2, {
      finalPrompt: 'model B projection',
      promptInputSnapshot: promptInputSnapshot('same-common-input'),
    });

    expect(groupEquivalentPromptVersions([first, second]).map((group) => group.map((item) => item.id))).toEqual([
      ['version-1', 'version-2'],
    ]);
  });

  it('orders a reused older Prompt by its newest occurrence', () => {
    const first = version(1);
    const middle = version(2, { manualPrompt: 'night portrait', finalPrompt: 'night portrait, natural light' });
    const returned = version(3);

    expect(
      groupEquivalentPromptVersions([first, middle, returned]).map((group) => group.map((item) => item.id)),
    ).toEqual([['version-2'], ['version-1', 'version-3']]);
  });

  it('keeps an explicit version link and projects a differing exact Prompt as its external variant', () => {
    const versions = [version(1), version(2, { finalPrompt: 'a newer saved prompt' })];

    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: 'version-2',
          generationText: 'external exact prompt',
        }),
        versions,
      ),
    ).toEqual({
      kind: 'LINKED_VARIANT',
      versionId: 'version-2',
      prompt: 'external exact prompt',
      baselinePrompt: 'a newer saved prompt',
    });
  });

  it('resolves the linked version independently of imported Prompt text for detail views', () => {
    const versions = [version(1), version(2, { finalPrompt: 'a newer saved prompt' })];
    const output = importedOutput({
      promptVersionId: 'version-2',
      generationText: 'external exact prompt',
    });

    expect(linkedPromptVersion(output, versions)?.id).toBe('version-2');
  });

  it('does not silently relink an explicitly linked output when its text matches another version', () => {
    const versions = [version(1), version(2, { finalPrompt: 'a newer saved prompt' })];

    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: 'version-2',
          generationText: ' portrait,   natural light ',
        }),
        versions,
      ),
    ).toEqual({
      kind: 'LINKED_VARIANT',
      versionId: 'version-2',
      prompt: 'portrait,   natural light',
      baselinePrompt: 'a newer saved prompt',
    });
  });

  it('stacks an exact Prompt on its explicitly linked version when that version matches', () => {
    const versions = [version(1), version(2, { finalPrompt: 'a newer saved prompt' })];

    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: 'version-2',
          generationText: ' a newer   saved prompt ',
        }),
        versions,
      ),
    ).toEqual({ kind: 'VERSION', versionId: 'version-2' });
  });

  it('may match an unlinked exact Prompt without inventing structure for a nonmatching Prompt', () => {
    const versions = [version(1), version(2, { finalPrompt: 'a newer saved prompt' })];

    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: null,
          generationText: ' portrait,   natural light ',
        }),
        versions,
      ),
    ).toEqual({ kind: 'VERSION', versionId: 'version-1' });
    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: null,
          generationText: 'external exact prompt',
        }),
        versions,
      ),
    ).toEqual({ kind: 'STANDALONE', prompt: 'external exact prompt' });
  });

  it('matches an imported exact Prompt against a frozen run input for new versions', () => {
    const target = version(1, {
      finalPrompt: 'compatibility projection from another model',
      promptInputSnapshot: promptInputSnapshot('common-input'),
      runs: [
        {
          id: 'run-1',
          modelKey: 'model-a',
          status: 'SUCCEEDED',
          canvasPresetKey: null,
          width: 1024,
          height: 1024,
          quality: 'low',
          asset: null,
          derivation: null,
          errorMessage: null,
          createdAt: '2026-07-30T00:00:00.000Z',
          executionInputSnapshot: {
            id: 'execution-1',
            route: 'PROVIDER_ADAPTER',
            requestSchema: 'test.v1',
            commonInput: {
              promptInput: promptInputSnapshot('common-input').commonInput,
              resolvedPrompt: {
                userInstruction: 'portrait',
                effectiveTerms: [],
                contributions: [],
                commonExpression: 'provider exact prompt',
                negativeExpression: '',
                sourcePaths: [],
                frozenReferences: [],
              },
              referenceAssetIds: [],
              canvasPresetKey: null,
              width: 1024,
              height: 1024,
              quality: 'low',
            },
            actualRequest: { prompt: 'provider exact prompt' },
            clientRequestText: 'provider exact prompt',
            contentHash: 'execution-hash',
            createdAt: '2026-07-30T00:00:00.000Z',
          },
        },
      ],
    });

    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: target.id,
          generationText: 'provider exact prompt with an external adjustment',
        }),
        [target],
      ),
    ).toEqual({
      kind: 'LINKED_VARIANT',
      versionId: target.id,
      prompt: 'provider exact prompt with an external adjustment',
      baselinePrompt: 'provider exact prompt',
    });
    expect(
      importedPromptPlacement(
        importedOutput({
          promptVersionId: null,
          generationText: 'provider exact prompt',
        }),
        [target],
      ),
    ).toEqual({ kind: 'VERSION', versionId: target.id });
  });
});
