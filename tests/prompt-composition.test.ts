import { describe, expect, it } from 'vitest';
import {
  collectEffectiveTermsFromComposition,
  composePromptFromComposition,
  PromptCompositionConflictError,
  resolvePromptComposition,
  type PromptCompositionInput,
  type PromptRecipeUseInput,
  type PromptTermInput,
} from '../src/shared/prompt-composition';

function term(stableId: string, positiveExpression: string, overrides: Partial<PromptTermInput> = {}): PromptTermInput {
  return {
    stableId,
    revisionId: `${stableId}:revision:1`,
    expressionRevisionId: `${stableId}:gpt-image-2:1`,
    label: stableId,
    positiveExpression,
    negativeExpression: '',
    ...overrides,
  };
}

function recipe(overrides: Partial<PromptRecipeUseInput> = {}): PromptRecipeUseInput {
  const terms = overrides.terms ?? [];
  const parameterExpressions = overrides.parameterExpressions ?? [];
  const contributions = [
    ...terms.map((item) => ({ kind: 'TERM' as const, term: item })),
    ...parameterExpressions.map((parameter) => ({ kind: 'RECIPE_PARAMETER' as const, parameter })),
  ];
  return {
    useId: 'recipe-use:beauty',
    stableId: 'recipe:young-east-asian-beauty',
    revisionId: 'recipe:young-east-asian-beauty:revision:1',
    terms,
    parameterExpressions,
    contentExpressions:
      overrides.contentExpressions ??
      contributions.flatMap((content, index) => [
        ...(index
          ? [
              {
                kind: 'RECIPE_FRAGMENT' as const,
                stableId: `separator:${index}`,
                positiveExpression: ', ',
              },
            ]
          : []),
        content,
      ]),
    references: [],
    ...overrides,
  };
}

function composition(overrides: Partial<PromptCompositionInput> = {}): PromptCompositionInput {
  return {
    userInstruction: 'A quiet summer poolside portrait',
    directTerms: [],
    recipes: [],
    exclusions: [],
    specs: [],
    ...overrides,
  };
}

describe('prompt composition resolver', () => {
  it('resolves user text, ordered terms, recipe parameters, references, specs and negatives', () => {
    const input = composition({
      directTerms: [
        term('term:environmental-portrait', '35mm environmental portrait', {
          label: '广角环境人像',
          negativeExpression: 'avoid ultra-wide distortion',
        }),
      ],
      recipes: [
        recipe({
          terms: [
            term('term:adult-east-asian', 'adult East Asian woman', { label: '当代东亚美女' }),
            term('term:natural-skin', 'natural minimally retouched skin', {
              label: '反精修美学',
              negativeExpression: 'no waxy skin',
            }),
          ],
          parameterExpressions: [
            {
              stableId: 'parameter:wardrobe-finish',
              revisionId: 'parameter:wardrobe-finish:revision:1',
              optionStableId: 'option:industrial-luxe',
              expressionRevisionId: 'parameter:wardrobe-finish:expression:1',
              positiveExpression: 'intricate industrial-luxe wardrobe',
              negativeExpression: 'no random ornament clutter',
            },
          ],
          references: [
            {
              stableId: 'material:look-reference',
              revisionId: 'material:look-reference:revision:3',
              contentHash: 'sha256:reference',
              role: 'STYLE_REFERENCE',
            },
          ],
        }),
      ],
      specs: [
        {
          stableId: 'spec:portrait-2-3',
          revisionId: 'spec:portrait-2-3:revision:2',
          expressionRevisionId: 'spec:portrait-2-3:expression:1',
          positiveExpression: 'portrait canvas, 2:3',
          negativeExpression: 'no text or logos',
        },
      ],
    });

    const result = resolvePromptComposition(input);

    expect(result.commonExpression).toBe(
      [
        'A quiet summer poolside portrait',
        '35mm environmental portrait',
        'adult East Asian woman',
        'natural minimally retouched skin',
        'intricate industrial-luxe wardrobe',
        'portrait canvas, 2:3',
      ].join(', '),
    );
    expect(result.negativeExpression).toBe(
      ['avoid ultra-wide distortion', 'no waxy skin', 'no random ornament clutter', 'no text or logos'].join(', '),
    );
    expect(result.effectiveTerms.map((item) => item.stableId)).toEqual([
      'term:environmental-portrait',
      'term:adult-east-asian',
      'term:natural-skin',
    ]);
    expect(result.contributions.map((item) => item.kind)).toEqual([
      'USER_INSTRUCTION',
      'TERM',
      'TERM',
      'RECIPE_FRAGMENT',
      'TERM',
      'RECIPE_FRAGMENT',
      'RECIPE_PARAMETER',
      'SPEC',
    ]);
    expect(result.frozenReferences.map((item) => item.kind)).toEqual([
      'TERM_EXPRESSION_REVISION',
      'RECIPE_REVISION',
      'TERM_EXPRESSION_REVISION',
      'TERM_EXPRESSION_REVISION',
      'RECIPE_PARAMETER_EXPRESSION',
      'MATERIAL_REVISION',
      'SPEC_EXPRESSION_REVISION',
    ]);
    expect(result.frozenReferences.find((item) => item.kind === 'MATERIAL_REVISION')).toMatchObject({
      stableId: 'material:look-reference',
      revisionId: 'material:look-reference:revision:3',
      contentHash: 'sha256:reference',
      role: 'STYLE_REFERENCE',
    });
  });

  it('deduplicates a term by stable ID while retaining direct and recipe source paths', () => {
    const shared = term('term:natural-skin', 'natural skin', { label: '自然皮肤' });
    const result = resolvePromptComposition(
      composition({
        directTerms: [shared],
        recipes: [recipe({ terms: [{ ...shared, label: 'Natural skin' }] })],
      }),
    );

    expect(result.commonExpression).toBe('A quiet summer poolside portrait, natural skin');
    expect(result.effectiveTerms).toHaveLength(1);
    expect(result.effectiveTerms[0].label).toBe('自然皮肤');
    expect(result.effectiveTerms[0].sourcePaths).toHaveLength(2);
    expect(result.effectiveTerms[0].sourcePaths.map((path) => path.segments.map((segment) => segment.kind))).toEqual([
      ['DIRECT_INPUT', 'TERM'],
      ['RECIPE_USE', 'TERM'],
    ]);
    const frozenTerm = result.frozenReferences.find((item) => item.kind === 'TERM_EXPRESSION_REVISION');
    expect(frozenTerm?.sourcePaths).toHaveLength(2);
    expect(result.frozenReferences.filter((item) => item.kind === 'RECIPE_REVISION')).toHaveLength(1);
  });

  it('applies source-scoped exclusions without discarding another source of the same term', () => {
    const shared = term('term:shared', 'shared expression');
    const result = resolvePromptComposition(
      composition({
        directTerms: [shared],
        recipes: [
          recipe({
            terms: [shared, term('term:recipe-only', 'recipe-only expression')],
            parameterExpressions: [
              {
                stableId: 'parameter:finish',
                revisionId: 'parameter:finish:revision:1',
                optionStableId: 'option:clean',
                expressionRevisionId: 'parameter:finish:expression:1',
                positiveExpression: 'clean finish',
              },
            ],
            references: [
              {
                stableId: 'material:recipe-reference',
                revisionId: 'material:recipe-reference:revision:1',
                contentHash: 'sha256:recipe-reference',
                role: 'REFERENCE',
              },
            ],
          }),
        ],
        specs: [
          {
            stableId: 'spec:social',
            revisionId: 'spec:social:revision:1',
            expressionRevisionId: 'spec:social:expression:1',
            positiveExpression: 'social post crop',
          },
        ],
        exclusions: [
          {
            targetKind: 'TERM',
            stableId: shared.stableId,
            scope: { kind: 'RECIPE_USE', useId: ' recipe-use:beauty ' },
          },
          {
            targetKind: 'RECIPE_PARAMETER',
            stableId: 'parameter:finish',
            scope: { kind: 'RECIPE_USE', useId: 'recipe-use:beauty' },
          },
          {
            targetKind: 'REFERENCE',
            stableId: 'material:recipe-reference',
            scope: { kind: 'RECIPE_USE', useId: 'recipe-use:beauty' },
          },
          { targetKind: 'SPEC', stableId: 'spec:social' },
        ],
      }),
    );

    expect(result.commonExpression).toBe(
      ['A quiet summer poolside portrait', 'shared expression', 'recipe-only expression'].join(', '),
    );
    expect(result.effectiveTerms.find((item) => item.stableId === shared.stableId)?.sourcePaths).toHaveLength(1);
    expect(result.frozenReferences.some((item) => item.kind === 'RECIPE_PARAMETER_EXPRESSION')).toBe(false);
    expect(result.frozenReferences.some((item) => item.kind === 'MATERIAL_REVISION')).toBe(false);
    expect(result.frozenReferences.some((item) => item.kind === 'SPEC_EXPRESSION_REVISION')).toBe(false);
    expect(result.frozenReferences.filter((item) => item.kind === 'EXCLUSION')).toHaveLength(4);
  });

  it('removes every source when a stable term ID is excluded globally', () => {
    const shared = term('term:shared', 'shared expression');
    const result = resolvePromptComposition(
      composition({
        directTerms: [shared],
        recipes: [recipe({ terms: [shared] })],
        exclusions: [{ targetKind: 'TERM', stableId: shared.stableId }],
      }),
    );

    expect(result.effectiveTerms).toEqual([]);
    expect(result.commonExpression).toBe('A quiet summer poolside portrait');
    expect(result.frozenReferences.map((item) => item.kind)).toEqual(['RECIPE_REVISION', 'EXCLUSION']);
  });

  it('rejects conflicting exact revisions for the same stable contribution ID', () => {
    const direct = term('term:skin', 'natural skin');
    const conflicting = term('term:skin', 'porcelain skin', {
      revisionId: 'term:skin:revision:2',
      expressionRevisionId: 'term:skin:gpt-image-2:2',
    });

    expect(() =>
      resolvePromptComposition(
        composition({
          directTerms: [direct],
          recipes: [recipe({ terms: [conflicting] })],
        }),
      ),
    ).toThrow(PromptCompositionConflictError);
    expect(() =>
      resolvePromptComposition(
        composition({
          directTerms: [direct],
          recipes: [recipe({ terms: [conflicting] })],
        }),
      ),
    ).toThrow('Conflicting TERM revisions or expressions for stable ID: term:skin');
  });

  it('keeps inputs immutable and exposes small compatibility helpers', () => {
    const input = composition({
      userInstruction: '  quiet portrait  ',
      directTerms: [term('term:light', 'soft light')],
      separator: ' | ',
      negativeSeparator: ' / ',
    });
    const before = structuredClone(input);

    expect(composePromptFromComposition(input)).toBe('quiet portrait | soft light');
    expect(collectEffectiveTermsFromComposition(input).map((item) => item.stableId)).toEqual(['term:light']);
    expect(input).toEqual(before);
  });
});
