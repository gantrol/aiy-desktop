import type {
  AssistantRunDto,
  CodexAssistRecipeInput,
  CodexAssistTermInput,
  DirectionExperimentDelegationInput,
  DirectionProposalDto,
  Locale,
  StyleExplorationStartInput,
} from '@/shared/contracts';
import { resolvePromptComposition, type PromptTermInput } from '@/shared/prompt-composition';

interface BuildStyleExplorationInput {
  assistantRun: AssistantRunDto;
  directions: DirectionProposalDto[];
  locale: Locale;
  delegation?: DirectionExperimentDelegationInput;
}

function frozenTerms(terms: readonly CodexAssistTermInput[]): PromptTermInput[] {
  return terms.flatMap((term) =>
    term.promptFragment.trim() || term.negativeFragment.trim()
      ? [
          {
            stableId: term.stableId,
            revisionId: term.revisionId,
            expressionRevisionId: term.expressionRevisionId ?? term.revisionId,
            label: term.displayName,
            positiveExpression: term.promptFragment,
            negativeExpression: term.negativeFragment,
          },
        ]
      : [],
  );
}

function frozenRecipe(recipe: CodexAssistRecipeInput) {
  return {
    useId: recipe.useId,
    stableId: recipe.stableId,
    revisionId: recipe.revisionId,
    terms: frozenTerms(recipe.internalTerms),
    parameterExpressions: recipe.parameters.flatMap((parameter) =>
      parameter.selectedOptionId && parameter.promptFragment.trim()
        ? [
            {
              stableId: parameter.stableId,
              revisionId: parameter.revisionId,
              optionStableId: parameter.selectedOptionId,
              expressionRevisionId: parameter.selectedOptionId,
              positiveExpression: parameter.promptFragment,
            },
          ]
        : [],
    ),
    contentExpressions: recipe.promptFragment.trim()
      ? [
          {
            kind: 'RECIPE_FRAGMENT' as const,
            stableId: `${recipe.revisionId}:frozen-prompt`,
            positiveExpression: recipe.promptFragment,
            negativeExpression: recipe.negativeFragment,
          },
        ]
      : [],
    references: [],
  };
}

/** Rebuild the generation brief exclusively from the proposal's immutable
 * request. Editor changes made while the proposal was running cannot leak into
 * a normal or adjacent direction experiment. */
export function buildStyleExplorationStartInput({
  assistantRun,
  directions,
  locale,
  delegation,
}: BuildStyleExplorationInput): StyleExplorationStartInput {
  const result = assistantRun.proposal?.result;
  if (!result || assistantRun.status !== 'SUCCEEDED') {
    throw new Error('A completed assistant proposal is required');
  }
  const frozen = assistantRun.input;
  if (!frozen.generationTargets.length) throw new Error('The frozen proposal has no generation target');
  return {
    scope: assistantRun.scope,
    sourceAssistantRunId: assistantRun.id,
    commonConstraints: result.sharedConstraints,
    slots: directions.map((direction) => {
      const resolvedPrompt = resolvePromptComposition({
        userInstruction: direction.prompt,
        directTerms: frozenTerms(frozen.directTerms),
        recipes: frozen.recipes.map(frozenRecipe),
        exclusions: [],
        specs: [],
      });
      return {
        label: direction.label,
        rationale: direction.rationale,
        variableAxis: direction.variableAxis,
        risk: direction.risk,
        userInstruction: direction.prompt,
        input: {
          title: direction.label,
          titleLocale: locale,
          manualPrompt: direction.prompt,
          // This renderer composition is a preview only. The main process
          // independently resolves the execution prompt from the same frozen
          // revisions and rejects any mismatch in the authorization boundary.
          prompt: resolvedPrompt.commonExpression,
          resolvedPrompt,
          changeSummary:
            locale === 'zh' ? `方向实验 · ${direction.label}` : `Direction experiment · ${direction.label}`,
          referenceAssetIds: frozen.referenceAssets.map((asset) => asset.assetId),
          termPromptLocale: frozen.termPromptLocale,
          termIds: frozen.directTerms.map((term) => term.stableId),
          wordPaletteReferences: frozen.recipes.map((recipe) => ({
            paletteId: recipe.stableId,
            paletteRevisionId: recipe.revisionId,
            parameterValues: { ...recipe.parameterValues },
            promptLocale: recipe.promptLocale,
          })),
          canvasPresetKey: frozen.canvasPresetKey,
          width: frozen.canvasWidth,
          height: frozen.canvasHeight,
          quality: frozen.generationTargets[0]?.quality ?? 'low',
        },
      };
    }),
    targets: frozen.generationTargets.map((target) => ({ ...target })),
    ...(delegation
      ? {
          delegation: {
            ...delegation,
            remoteScope: [...delegation.remoteScope],
            decisions: delegation.decisions.map((decision) => ({ ...decision })),
          },
        }
      : {}),
  };
}
