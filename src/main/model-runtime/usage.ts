import {
  modelRuntimeTokenUsageSchema,
  type ModelRuntimeTokenUsage,
  type ModelRuntimeUsageState,
} from '@/main/model-runtime/contracts';

function unavailableValue(state: Exclude<ModelRuntimeUsageState, 'PROVIDED'>) {
  return { state, value: null } as const;
}

function providerValue(value: number | undefined) {
  return value === undefined ? unavailableValue('MISSING') : ({ state: 'PROVIDED', value } as const);
}

export function unavailableModelRuntimeTokenUsage(
  state: Exclude<ModelRuntimeUsageState, 'PROVIDED'>,
): ModelRuntimeTokenUsage {
  return modelRuntimeTokenUsageSchema.parse({
    inputTokens: unavailableValue(state),
    cachedInputTokens: unavailableValue(state),
    outputTokens: unavailableValue(state),
    reasoningTokens: unavailableValue(state),
    totalTokens: unavailableValue(state),
  });
}

export function providerModelRuntimeTokenUsage(
  usage:
    | {
        inputTokens?: number;
        cachedInputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
      }
    | null
    | undefined,
): ModelRuntimeTokenUsage {
  if (!usage) return unavailableModelRuntimeTokenUsage('MISSING');
  return modelRuntimeTokenUsageSchema.parse({
    inputTokens: providerValue(usage.inputTokens),
    cachedInputTokens: providerValue(usage.cachedInputTokens),
    outputTokens: providerValue(usage.outputTokens),
    reasoningTokens: providerValue(usage.reasoningTokens),
    totalTokens: providerValue(usage.totalTokens),
  });
}
