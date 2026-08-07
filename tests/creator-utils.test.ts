import { describe, expect, it } from 'vitest';
import type {
  PromptInputSnapshotDto,
  PromptSeriesDto,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
} from '../src/shared/contracts';
import {
  allAssets,
  buildCreatorAssistContext,
  collectPromptTerms,
  composePrompt,
  creatorInputMatchesVersion,
  resolveCreatorPrompt,
  wordPaletteUseId,
  type AppliedWordPalette,
} from '../src/renderer/components/creator/utils';

const metrics = {
  citationCount: 0,
  distinctPromptSeries: 0,
  positiveEvidence: 0,
  negativeEvidence: 0,
  pendingIssues: 0,
  lastValidatedAt: null,
};

function emptyPromptInputSnapshot(id: string, createdAt: string): PromptInputSnapshotDto {
  return {
    id: `snapshot-${id}`,
    sourceKind: 'COMPOSED',
    commonInput: {
      userInstruction: '',
      directTermPromptLocale: 'en',
      directTerms: [],
      recipes: [],
      directReferences: [],
    },
    contentHash: `hash-${id}`,
    createdAt,
  };
}

function term(id: string, positive: string): TermListItem {
  return {
    id,
    stableKey: id,
    title: id,
    titleLocale: 'en',
    definition: '',
    aliases: [],
    localizations: [{ locale: 'zh', title: `${id}-zh`, definition: '', aliases: [] }],
    editorialState: 'APPROVED',
    revisionNo: 1,
    termRevisionId: `${id}-revision-1`,
    modelExpressions: [
      {
        id: `${id}-expression-1`,
        contextKey: 'general.default',
        modelKey: 'gpt-image-2',
        locale: 'en',
        positive,
        negative: '',
      },
    ],
    classificationIds: [],
    classifications: [],
    primaryDirectoryClassificationId: null,
    hasDraft: false,
    mediaPreview: { totalCount: 0, items: [] },
    metrics,
  };
}

function palette(terms: TermListItem[]): WordPaletteDto {
  const revision = {
    id: 'palette-body-v1',
    revisionNo: 1,
    name: '身材实验',
    nameLocale: 'zh',
    description: '',
    localizations: [{ locale: 'en', name: 'Body lab', description: '' }],
    kind: 'PARAMETERIZED' as const,
    terms,
    parameters: [
      {
        id: 'parameter-height',
        stableKey: 'height',
        name: '身高',
        nameLocale: 'zh',
        localizations: [{ locale: 'en', name: 'Height' }],
        required: true,
        options: [
          {
            id: 'option-tall',
            value: 'tall',
            label: '高挑',
            labelLocale: 'zh',
            localizations: [{ locale: 'en', label: 'Tall' }],
            contents: [
              {
                id: 'option-tall-content',
                kind: 'TEXT' as const,
                promptFragment: 'tall stature',
                negativeFragment: '',
              },
            ],
          },
        ],
      },
    ],
    promptNodes: [
      ...terms.flatMap((term, index) => [
        ...(index
          ? [
              {
                id: `node-term-separator-${index}`,
                kind: 'TEXT' as const,
                promptFragment: ', ',
                negativeFragment: '',
              },
            ]
          : []),
        { id: `node-term-${index}`, kind: 'TERM' as const, term },
      ]),
      { id: 'node-slot-separator', kind: 'TEXT' as const, promptFragment: ', ', negativeFragment: '' },
      { id: 'node-slot', kind: 'SLOT' as const, stableKey: 'height' },
    ],
    referenceAssets: [],
    createdAt: '2026-07-24T00:00:00.000Z',
  };
  return {
    id: 'palette-body',
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    name: revision.name,
    nameLocale: revision.nameLocale,
    description: revision.description,
    localizations: revision.localizations,
    kind: revision.kind,
    status: 'ACTIVE',
    terms: revision.terms,
    parameters: revision.parameters,
    promptNodes: revision.promptNodes,
    referenceAssets: revision.referenceAssets,
    revisions: [revision],
    usageCount: 0,
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
}

describe('creator prompt composition', () => {
  const face = term('oval-face', 'oval face');
  const slim = term('slim-build', 'slim build');
  const bodyPalette = palette([slim]);
  const reference: AppliedWordPalette = {
    palette: bodyPalette,
    revision: bodyPalette.revisions[0],
    parameterValues: { height: 'tall' },
    promptLocale: 'en',
  };

  it('keeps manual input separate and composes a live prompt', () => {
    const manual = 'soft daylight portrait';
    expect(composePrompt(manual, [face], [reference])).toBe(
      'soft daylight portrait, oval face, slim build, tall stature',
    );
    expect(manual).toBe('soft daylight portrait');
  });

  it('removes every palette contribution when its reference is removed', () => {
    expect(composePrompt('portrait', [face], [reference])).toContain('slim build');
    expect(composePrompt('portrait', [face], [])).toBe('portrait, oval face');
  });

  it('keeps model expressions exact while rendering palette parameters in the selected language', () => {
    const chineseReference: AppliedWordPalette = { ...reference, promptLocale: 'zh' };
    expect(composePrompt('柔和日光人像', [], [chineseReference])).toBe('柔和日光人像, slim build, tall stature');
  });

  it('uses localized term labels without substituting an unversioned label for a model expression', () => {
    const resolution = resolveCreatorPrompt({
      manualPrompt: '柔和日光人像',
      selectedTerms: [face],
      appliedPalettes: [],
      termPromptLocale: 'zh',
    });
    expect(resolution.livePrompt).toBe('柔和日光人像, oval face');
    expect(resolution.composition.effectiveTerms[0].label).toBe('oval-face-zh');
    expect(composePrompt('soft daylight portrait', [face], [], 'en')).toBe('soft daylight portrait, oval face');
  });

  it('keeps direct terms independent while collecting palette terms for generation bindings', () => {
    const selected = [face];
    expect(collectPromptTerms(selected, [reference]).map((item) => item.id)).toEqual(['oval-face', 'slim-build']);
    expect(selected.map((item) => item.id)).toEqual(['oval-face']);
  });

  it('sends recipes to the assistant as aggregate references instead of direct terms', () => {
    const recipeAsset = {
      id: 'recipe-reference-1',
      kind: 'REFERENCE' as const,
      originType: 'LOCAL_IMPORT',
      width: 768,
      height: 1024,
      mimeType: 'image/png',
      mediaUrl: 'aibd-media://recipe-reference-1',
      createdAt: '2026-07-24T00:00:00.000Z',
    };
    const recipeRevision = { ...bodyPalette.revisions[0], referenceAssets: [recipeAsset] };
    const recipePalette = {
      ...bodyPalette,
      revisionId: recipeRevision.id,
      referenceAssets: [recipeAsset],
      revisions: [recipeRevision],
    };
    const recipeReference: AppliedWordPalette = {
      palette: recipePalette,
      revision: recipeRevision,
      parameterValues: { height: 'tall' },
      promptLocale: 'en',
    };
    const resolution = resolveCreatorPrompt({
      manualPrompt: 'portrait',
      selectedTerms: [face],
      appliedPalettes: [recipeReference],
      termPromptLocale: 'en',
    });

    const context = buildCreatorAssistContext(resolution, [face], 'en');

    expect(context.prompt).toBe('portrait');
    expect(context.directTerms.map((item) => item.stableId)).toEqual(['oval-face']);
    expect(context.recipes).toHaveLength(1);
    expect(context.recipes[0]).toMatchObject({
      useId: 'palette-body:palette-body-v1',
      stableId: 'palette-body',
      revisionId: 'palette-body-v1',
      displayName: 'Body lab',
      parameterValues: { height: 'tall' },
      promptFragment: 'slim build, tall stature',
      parameters: [
        {
          stableId: 'parameter-height',
          revisionId: 'parameter-height',
          selectedValue: 'tall',
          selectedOptionId: 'option-tall',
        },
      ],
      referenceAssets: [
        {
          assetId: 'recipe-reference-1',
          kind: 'REFERENCE',
          originType: 'LOCAL_IMPORT',
          width: 768,
          height: 1024,
          mimeType: 'image/png',
        },
      ],
    });
    expect(context.recipes[0].internalTerms.map((item) => item.stableId)).toEqual(['slim-build']);
    expect(context.directTerms.map((item) => item.stableId)).not.toContain('slim-build');
    expect(context).not.toHaveProperty('selectedTerms');
  });

  it('freezes real term, expression, recipe, parameter and option row identities', () => {
    const overlappingPalette = palette([face, slim]);
    const overlappingReference: AppliedWordPalette = {
      palette: overlappingPalette,
      revision: overlappingPalette.revisions[0],
      parameterValues: { height: 'tall' },
      promptLocale: 'en',
    };
    const resolution = resolveCreatorPrompt({
      manualPrompt: 'portrait',
      selectedTerms: [face],
      appliedPalettes: [overlappingReference],
    });

    expect(resolution.livePrompt).toBe('portrait, oval face, slim build, tall stature');
    expect(resolution.effectiveTerms.map(({ term }) => term.id)).toEqual(['oval-face', 'slim-build']);
    expect(resolution.effectiveTerms[0]).toMatchObject({
      directSource: true,
      recipeUseIds: [wordPaletteUseId(overlappingReference)],
    });
    expect(resolution.effectiveTerms[0].resolved.sourcePaths).toHaveLength(2);
    expect(resolution.effectiveTerms[1]).toMatchObject({ directSource: false });
    expect(resolution.composition.frozenReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'TERM_EXPRESSION_REVISION',
          stableId: 'oval-face',
          revisionId: 'oval-face-revision-1',
          expressionRevisionId: 'oval-face-expression-1',
        }),
        expect.objectContaining({
          kind: 'RECIPE_REVISION',
          useId: 'palette-body:palette-body-v1',
          stableId: 'palette-body',
          revisionId: 'palette-body-v1',
        }),
        expect.objectContaining({
          kind: 'RECIPE_PARAMETER_EXPRESSION',
          stableId: 'parameter-height:option-tall-content',
          revisionId: 'parameter-height',
          optionStableId: 'option-tall',
          expressionRevisionId: 'option-tall-content',
        }),
      ]),
    );
  });

  it('does not invent a model-expression identity or fall back to display text', () => {
    const unresolved = {
      ...face,
      modelExpressionRevisionId: null,
      modelExpressionModelKey: null,
      modelExpressions: [],
      promptFragment: 'unversioned fallback',
    };
    const resolution = resolveCreatorPrompt({
      manualPrompt: 'portrait',
      selectedTerms: [unresolved],
      appliedPalettes: [],
    });
    expect(resolution.livePrompt).toBe('portrait');
    expect(resolution.effectiveTerms).toEqual([]);
    expect(resolution.composition.frozenReferences).toEqual([]);
  });

  it('can resolve a target-specific expression without changing the common UI default', () => {
    const multiModel = {
      ...face,
      modelExpressions: [
        ...face.modelExpressions,
        {
          id: 'oval-face-other-expression-3',
          contextKey: 'general.default',
          modelKey: 'other-image-model',
          locale: 'en',
          positive: 'other-model oval portrait',
          negative: 'other-model negative',
        },
      ],
    };
    const resolution = resolveCreatorPrompt({
      manualPrompt: 'portrait',
      selectedTerms: [multiModel],
      appliedPalettes: [],
      modelKey: 'other-image-model',
    });
    expect(resolution.livePrompt).toBe('portrait, other-model oval portrait');
    expect(resolution.negativePrompt).toBe('other-model negative');
    expect(resolution.effectiveTerms[0].resolved.expressionRevisionId).toBe('oval-face-other-expression-3');
  });

  it('auto-links an imported output only while the editor matches the exact frozen version input', () => {
    const version = {
      id: 'version-1',
      versionNo: 1,
      manualPrompt: 'portrait',
      finalPrompt: 'portrait, oval face, slim build, tall stature',
      isStructured: true,
      termPromptLocale: 'en',
      termIds: [face.id],
      wordPaletteReferences: [
        {
          paletteId: bodyPalette.id,
          paletteRevisionId: bodyPalette.revisions[0].id,
          parameterValues: { height: 'tall' },
          promptLocale: 'en',
        },
      ],
      referenceAssets: [],
      changeSummary: '',
      createdAt: '2026-07-24T00:00:00.000Z',
      runs: [],
      promptInputSnapshot: {
        id: 'snapshot-1',
        sourceKind: 'COMPOSED',
        contentHash: 'hash-1',
        createdAt: '2026-07-24T00:00:00.000Z',
        commonInput: {
          userInstruction: 'portrait',
          directTermPromptLocale: 'en',
          directTerms: [{ termId: face.id, termRevisionId: face.termRevisionId }],
          recipes: [
            {
              useId: wordPaletteUseId(reference),
              paletteId: bodyPalette.id,
              paletteRevisionId: bodyPalette.revisions[0].id,
              name: bodyPalette.name,
              nameLocale: bodyPalette.nameLocale,
              localizations: bodyPalette.localizations.map(({ locale, name }) => ({ locale, name })),
              promptLocale: 'en',
              parameterValues: { height: 'tall' },
              terms: [{ termId: slim.id, termRevisionId: slim.termRevisionId }],
              parameters: [
                {
                  parameterRevisionId: 'parameter-height',
                  stableKey: 'height',
                  optionId: 'option-tall',
                  valueKey: 'tall',
                },
              ],
              contentNodes: [
                { id: 'node-term-0', kind: 'TERM', term: { termId: slim.id, termRevisionId: slim.termRevisionId } },
                { id: 'node-slot-separator', kind: 'TEXT', promptFragment: ', ', negativeFragment: '' },
                {
                  id: 'node-slot',
                  kind: 'SLOT',
                  stableKey: 'height',
                  parameter: {
                    parameterRevisionId: 'parameter-height',
                    stableKey: 'height',
                    optionId: 'option-tall',
                    valueKey: 'tall',
                  },
                  contents: [
                    {
                      id: 'option-tall-content',
                      kind: 'TEXT',
                      promptFragment: 'tall stature',
                      negativeFragment: '',
                    },
                  ],
                },
              ],
              references: [],
            },
          ],
          directReferences: [],
        },
      },
    } satisfies PromptVersionDto;
    const exact = {
      version,
      manualPrompt: 'portrait',
      selectedTerms: [face],
      appliedPalettes: [reference],
      termPromptLocale: 'en' as const,
      referenceAssets: [],
    };

    expect(creatorInputMatchesVersion(exact)).toBe(true);
    expect(creatorInputMatchesVersion({ ...exact, manualPrompt: 'changed portrait' })).toBe(false);
    expect(
      creatorInputMatchesVersion({
        ...exact,
        selectedTerms: [{ ...face, termRevisionId: 'oval-face-revision-2' }],
      }),
    ).toBe(false);
    expect(
      creatorInputMatchesVersion({
        ...exact,
        appliedPalettes: [{ ...reference, parameterValues: { height: 'short' } }],
      }),
    ).toBe(false);
    expect(creatorInputMatchesVersion({ ...exact, termPromptLocale: 'zh' })).toBe(false);
  });

  it('sorts images across prompt versions by image creation time', () => {
    const asset = (id: string, createdAt: string) => ({
      id,
      createdAt,
      kind: 'GENERATED' as const,
      width: 1024,
      height: 1536,
      mimeType: 'image/png',
      mediaUrl: `aibd-media://${id}`,
    });
    const series = {
      id: 'series',
      title: '系列',
      currentVersionId: 'version-2',
      cover: null,
      versions: [
        {
          id: 'version-2',
          versionNo: 2,
          manualPrompt: '',
          finalPrompt: '',
          isStructured: true,
          termPromptLocale: 'en',
          termIds: [],
          wordPaletteReferences: [],
          referenceAssets: [],
          changeSummary: '',
          createdAt: '2026-02-01T00:00:00.000Z',
          promptInputSnapshot: emptyPromptInputSnapshot('version-2', '2026-02-01T00:00:00.000Z'),
          runs: [
            {
              id: 'run-2',
              modelKey: 'gpt-image-2',
              status: 'SUCCEEDED',
              canvasPresetKey: null,
              width: 1024,
              height: 1536,
              quality: 'low',
              asset: asset('asset-older', '2026-03-01T00:00:00.000Z'),
              derivation: null,
              errorMessage: null,
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          ],
        },
        {
          id: 'version-1',
          versionNo: 1,
          manualPrompt: '',
          finalPrompt: '',
          isStructured: true,
          termPromptLocale: 'en',
          termIds: [],
          wordPaletteReferences: [],
          referenceAssets: [],
          changeSummary: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          promptInputSnapshot: emptyPromptInputSnapshot('version-1', '2026-01-01T00:00:00.000Z'),
          runs: [
            {
              id: 'run-1',
              modelKey: 'gpt-image-2',
              status: 'SUCCEEDED',
              canvasPresetKey: null,
              width: 1024,
              height: 1536,
              quality: 'low',
              asset: asset('asset-newer', '2026-04-01T00:00:00.000Z'),
              derivation: null,
              errorMessage: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    } satisfies PromptSeriesDto;

    expect(allAssets(series).map((item) => item.id)).toEqual(['asset-newer', 'asset-older']);
  });
});
