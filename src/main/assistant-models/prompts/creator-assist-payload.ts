import type { CodexAssistInput, CreatorAgentTurnDto } from '@/shared/contracts';

export function buildCreatorAssistPayload(input: CodexAssistInput, history: CreatorAgentTurnDto[] = []) {
  return {
    currentPrompt: {
      userInstruction: input.prompt.slice(0, 30_000),
      contentNodes: (input.contentNodes ?? []).slice(0, 100).map((node) =>
        node.kind === 'TEXT'
          ? { kind: node.kind, text: node.text.slice(0, 30_000) }
          : node.kind === 'TERM'
            ? {
                kind: node.kind,
                termId: node.termId.slice(0, 200),
                termRevisionId: node.termRevisionId.slice(0, 200),
              }
            : {
                kind: node.kind,
                paletteId: node.paletteId.slice(0, 200),
                paletteRevisionId: node.paletteRevisionId.slice(0, 200),
              },
      ),
      directTerms: input.directTerms.slice(0, 80).map((term) => ({
        termId: term.stableId.slice(0, 200),
        stableId: term.stableId.slice(0, 200),
        revisionId: term.revisionId.slice(0, 200),
        expressionRevisionId: term.expressionRevisionId?.slice(0, 200) ?? null,
        displayName: term.displayName.slice(0, 300),
        promptFragment: term.promptFragment.slice(0, 3_000),
        negativeFragment: term.negativeFragment.slice(0, 3_000),
      })),
      recipes: input.recipes.slice(0, 80).map((recipe) => ({
        paletteId: recipe.stableId.slice(0, 200),
        useId: recipe.useId.slice(0, 200),
        stableId: recipe.stableId.slice(0, 200),
        revisionId: recipe.revisionId.slice(0, 200),
        displayName: recipe.displayName.slice(0, 300),
        promptLocale: recipe.promptLocale,
        parameterValues: Object.fromEntries(
          Object.entries(recipe.parameterValues)
            .slice(0, 12)
            .map(([key, value]) => [key.slice(0, 64), value.slice(0, 300)]),
        ),
        parameters: recipe.parameters.slice(0, 12).map((parameter) => ({
          stableId: parameter.stableId.slice(0, 200),
          revisionId: parameter.revisionId.slice(0, 200),
          displayName: parameter.displayName.slice(0, 300),
          selectedValue: parameter.selectedValue.slice(0, 300),
          selectedOptionId: parameter.selectedOptionId?.slice(0, 200) ?? null,
          selectedOptionLabel: parameter.selectedOptionLabel.slice(0, 300),
          promptFragment: parameter.promptFragment.slice(0, 3_000),
        })),
        referenceAssets: recipe.referenceAssets.slice(0, 16).map((asset) => ({
          assetId: asset.assetId.slice(0, 200),
          kind: asset.kind,
          ...(asset.originType ? { originType: asset.originType.slice(0, 120) } : {}),
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType.slice(0, 200),
        })),
        promptFragment: recipe.promptFragment.slice(0, 30_000),
        negativeFragment: recipe.negativeFragment.slice(0, 30_000),
        internalTerms: recipe.internalTerms.slice(0, 1_000).map((term) => ({
          stableId: term.stableId.slice(0, 200),
          revisionId: term.revisionId.slice(0, 200),
          expressionRevisionId: term.expressionRevisionId?.slice(0, 200) ?? null,
          displayName: term.displayName.slice(0, 300),
          promptFragment: term.promptFragment.slice(0, 3_000),
          negativeFragment: term.negativeFragment.slice(0, 3_000),
        })),
      })),
      candidateTerms: (input.candidateTerms ?? []).slice(0, 40).map((term) => ({
        termId: term.stableId.slice(0, 200),
        termRevisionId: term.revisionId.slice(0, 200),
        expressionRevisionId: term.expressionRevisionId?.slice(0, 200) ?? null,
        displayName: term.displayName.slice(0, 300),
        promptFragment: term.promptFragment.slice(0, 3_000),
        negativeFragment: term.negativeFragment.slice(0, 3_000),
      })),
      referenceAssets: (input.referenceAssets ?? []).slice(0, 16).map((asset) => ({
        assetId: asset.assetId.slice(0, 200),
        kind: asset.kind,
        ...(asset.originType ? { originType: asset.originType.slice(0, 120) } : {}),
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType.slice(0, 200),
      })),
      canvasPresetKey: input.canvasPresetKey?.slice(0, 200) ?? null,
      canvasWidth: input.canvasWidth ?? null,
      canvasHeight: input.canvasHeight ?? null,
      generationTargets: (input.generationTargets ?? []).slice(0, 12).map((target) => ({
        modelKey: target.modelKey.slice(0, 200),
        count: target.count,
        quality: target.quality,
      })),
    },
    previousDirectionCoverage: (input.previousDirectionCoverage ?? []).slice(0, 16).map((direction) => ({
      label: direction.label.slice(0, 160),
      variableAxis: direction.variableAxis.slice(0, 240),
    })),
    message: input.message?.slice(0, 8_000) ?? '',
    conversation: history.slice(-20).map((turn) => ({
      creatorMessage: turn.message.slice(0, 8_000),
      attachmentAssetIds: turn.attachments.slice(0, 8).map((asset) => asset.id),
      assistantMessage: turn.result.assistantMessage.slice(0, 8_000),
      proposedPrompt:
        !turn.result.optimizedPrompt || turn.result.optimizedPrompt === turn.prompt
          ? ''
          : turn.result.optimizedPrompt.slice(0, 30_000),
    })),
  };
}
