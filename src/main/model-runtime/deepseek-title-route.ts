import { DEEPSEEK_PROVIDER_KEY } from '@/main/assistant-models/deepseek-provider';
import type { DeepSeekApiConnectionSnapshot } from '@/main/extensions/deepseek-api/types';
import {
  modelRuntimeCapabilitiesSchema,
  modelRuntimeTaskRequirementSchema,
  type ModelRuntimeCapabilities,
} from '@/main/model-runtime/contracts';
import { ModelRuntimeError } from '@/main/model-runtime/errors';
import { resolveModelRuntimeRoute } from '@/main/model-runtime/route-resolver';

const DEEPSEEK_TITLE_CAPABILITIES: ModelRuntimeCapabilities = modelRuntimeCapabilitiesSchema.parse({
  inputModalities: ['TEXT'],
  outputKinds: ['STRUCTURED_DATA'],
  structuredOutputModes: ['JSON_MODE'],
  executionModes: ['SYNCHRONOUS'],
  toolModes: ['NONE'],
  streamModes: ['NONE'],
  transcriptionTimestamps: ['NONE'],
  speakerIdentification: ['NONE'],
  returnedFacts: ['ACTUAL_MODEL_ID', 'USAGE', 'REQUEST_ID'],
});

export const DEEPSEEK_TITLE_REQUIREMENT = modelRuntimeTaskRequirementSchema.parse({
  operation: 'STRUCTURED_GENERATE',
  requiredInputModalities: ['TEXT'],
  outputKind: 'STRUCTURED_DATA',
  structuredOutputMode: 'JSON_MODE',
  executionMode: 'SYNCHRONOUS',
  toolMode: 'NONE',
  streamMode: 'NONE',
  transcriptionTimestamp: 'NONE',
  speakerIdentification: 'NONE',
});

export function resolveDeepSeekTitleRoute(connection: DeepSeekApiConnectionSnapshot) {
  const resolution = resolveModelRuntimeRoute({
    routes: [
      {
        routeId: 'assistant-title-deepseek',
        routeRevision: '1',
        providerId: DEEPSEEK_PROVIDER_KEY,
        connectionId: connection.connectionId,
        connectionRevision: connection.configurationRevision,
        adapterId: 'deepseek-responses',
        adapterRevision: 'responses-json-v1',
        modelId: connection.modelId,
        modelCatalogRevision: 'builtin-2026-08-11',
        promptProfileId: 'creator-title',
        promptProfileRevision: 'creator-title-v1',
        resourcePoolKey: 'deepseek-responses',
        operation: DEEPSEEK_TITLE_REQUIREMENT.operation,
        state: 'AVAILABLE',
        priority: 100,
        modelCapabilities: DEEPSEEK_TITLE_CAPABILITIES,
        adapterCapabilities: DEEPSEEK_TITLE_CAPABILITIES,
        routeCapabilities: DEEPSEEK_TITLE_CAPABILITIES,
        connectionCapabilities: DEEPSEEK_TITLE_CAPABILITIES,
      },
    ],
    requirement: DEEPSEEK_TITLE_REQUIREMENT,
    lockedRouteId: 'assistant-title-deepseek',
  });
  if (!resolution.ok) {
    throw new ModelRuntimeError({
      code: resolution.code,
      phase: 'PREPARING_INPUT',
      retryable: false,
      providerStarted: false,
      message: resolution.diagnostic,
      diagnostics: JSON.stringify(resolution.exclusions).slice(0, 1_000),
    });
  }
  return resolution.route;
}
