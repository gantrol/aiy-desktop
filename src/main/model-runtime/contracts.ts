import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const revisionSchema = z.string().trim().min(1).max(500);

export const modelRuntimeOperationSchema = z.enum([
  'TEXT_GENERATE',
  'STRUCTURED_GENERATE',
  'IMAGE_GENERATE',
  'IMAGE_EDIT',
  'AUDIO_TRANSCRIBE',
  'MEDIA_ANALYZE',
  'AGENT_TURN',
]);
export type ModelRuntimeOperation = z.infer<typeof modelRuntimeOperationSchema>;

export const modelRuntimeInputModalitySchema = z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO']);
export type ModelRuntimeInputModality = z.infer<typeof modelRuntimeInputModalitySchema>;

export const modelRuntimeOutputKindSchema = z.enum(['TEXT', 'STRUCTURED_DATA', 'IMAGE', 'TIMED_TRANSCRIPT']);
export type ModelRuntimeOutputKind = z.infer<typeof modelRuntimeOutputKindSchema>;

export const modelRuntimeStructuredOutputModeSchema = z.enum(['NONE', 'PROMPT_ONLY', 'JSON_MODE', 'NATIVE_SCHEMA']);
export type ModelRuntimeStructuredOutputMode = z.infer<typeof modelRuntimeStructuredOutputModeSchema>;

export const modelRuntimeExecutionModeSchema = z.enum(['SYNCHRONOUS', 'REMOTE_ASYNC', 'AGENT_TURN']);
export type ModelRuntimeExecutionMode = z.infer<typeof modelRuntimeExecutionModeSchema>;

export const modelRuntimeToolModeSchema = z.enum(['NONE', 'FUNCTION', 'PROVIDER_HOSTED', 'AGENT']);
export type ModelRuntimeToolMode = z.infer<typeof modelRuntimeToolModeSchema>;

export const modelRuntimeStreamModeSchema = z.enum(['NONE', 'TEXT_DELTA', 'EVENTS']);
export type ModelRuntimeStreamMode = z.infer<typeof modelRuntimeStreamModeSchema>;

export const modelRuntimeTranscriptionTimestampSchema = z.enum(['NONE', 'SEGMENT', 'WORD']);
export type ModelRuntimeTranscriptionTimestamp = z.infer<typeof modelRuntimeTranscriptionTimestampSchema>;

export const modelRuntimeSpeakerIdentificationSchema = z.enum(['NONE', 'ANONYMOUS_LABELS', 'IDENTIFIED_SPEAKERS']);
export type ModelRuntimeSpeakerIdentification = z.infer<typeof modelRuntimeSpeakerIdentificationSchema>;

export const modelRuntimeReturnedFactSchema = z.enum(['ACTUAL_MODEL_ID', 'USAGE', 'REQUEST_ID', 'REMOTE_OPERATION_ID']);
export type ModelRuntimeReturnedFact = z.infer<typeof modelRuntimeReturnedFactSchema>;

export const modelRuntimeCapabilitiesSchema = z
  .object({
    inputModalities: z.array(modelRuntimeInputModalitySchema).max(4),
    outputKinds: z.array(modelRuntimeOutputKindSchema).max(4),
    structuredOutputModes: z.array(modelRuntimeStructuredOutputModeSchema).max(4),
    executionModes: z.array(modelRuntimeExecutionModeSchema).max(3),
    toolModes: z.array(modelRuntimeToolModeSchema).max(4),
    streamModes: z.array(modelRuntimeStreamModeSchema).max(3),
    transcriptionTimestamps: z.array(modelRuntimeTranscriptionTimestampSchema).max(3),
    speakerIdentification: z.array(modelRuntimeSpeakerIdentificationSchema).max(3),
    returnedFacts: z.array(modelRuntimeReturnedFactSchema).max(4),
  })
  .strict();
export type ModelRuntimeCapabilities = z.infer<typeof modelRuntimeCapabilitiesSchema>;

export const modelRuntimeTaskRequirementSchema = z
  .object({
    operation: modelRuntimeOperationSchema,
    requiredInputModalities: z.array(modelRuntimeInputModalitySchema).min(1).max(4),
    outputKind: modelRuntimeOutputKindSchema,
    structuredOutputMode: modelRuntimeStructuredOutputModeSchema,
    executionMode: modelRuntimeExecutionModeSchema,
    toolMode: modelRuntimeToolModeSchema,
    streamMode: modelRuntimeStreamModeSchema,
    transcriptionTimestamp: modelRuntimeTranscriptionTimestampSchema,
    speakerIdentification: modelRuntimeSpeakerIdentificationSchema,
  })
  .strict();
export type ModelRuntimeTaskRequirement = z.infer<typeof modelRuntimeTaskRequirementSchema>;

export const modelRuntimeRouteDefinitionSchema = z
  .object({
    routeId: identifierSchema,
    routeRevision: revisionSchema,
    providerId: identifierSchema,
    connectionId: identifierSchema,
    connectionRevision: revisionSchema,
    adapterId: identifierSchema,
    adapterRevision: revisionSchema,
    modelId: identifierSchema,
    modelCatalogRevision: revisionSchema,
    promptProfileId: identifierSchema,
    promptProfileRevision: revisionSchema,
    resourcePoolKey: identifierSchema,
    operation: modelRuntimeOperationSchema,
    state: z.enum(['AVAILABLE', 'DISABLED', 'UNAVAILABLE']),
    priority: z.number().int().min(-1_000_000).max(1_000_000),
    modelCapabilities: modelRuntimeCapabilitiesSchema,
    adapterCapabilities: modelRuntimeCapabilitiesSchema,
    routeCapabilities: modelRuntimeCapabilitiesSchema,
    connectionCapabilities: modelRuntimeCapabilitiesSchema,
  })
  .strict();
export type ModelRuntimeRouteDefinition = z.infer<typeof modelRuntimeRouteDefinitionSchema>;

export const modelRuntimeRouteSnapshotSchema = modelRuntimeRouteDefinitionSchema
  .omit({
    state: true,
    priority: true,
    modelCapabilities: true,
    adapterCapabilities: true,
    routeCapabilities: true,
    connectionCapabilities: true,
  })
  .extend({
    effectiveCapabilities: modelRuntimeCapabilitiesSchema,
    selectedAt: z.string().datetime(),
  })
  .strict();
export type ModelRuntimeRouteSnapshot = z.infer<typeof modelRuntimeRouteSnapshotSchema>;

export const modelRuntimeInputManifestSchema = z
  .object({
    submittedInputModalities: z.array(modelRuntimeInputModalitySchema).min(1).max(4),
    submittedItemCount: z.number().int().positive(),
    submittedBytes: z.number().int().nonnegative().nullable(),
    sourceArtifactIds: z.array(identifierSchema).max(1_000),
    derivedEvidenceIds: z.array(identifierSchema).max(10_000),
  })
  .strict();
export type ModelRuntimeInputManifest = z.infer<typeof modelRuntimeInputManifestSchema>;

export const modelRuntimeUsageStateSchema = z.enum(['PROVIDED', 'MISSING', 'NOT_APPLICABLE', 'NOT_STARTED']);
export type ModelRuntimeUsageState = z.infer<typeof modelRuntimeUsageStateSchema>;

export const modelRuntimeUsageValueSchema = z
  .object({
    state: modelRuntimeUsageStateSchema,
    value: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'PROVIDED' && value.value === null) {
      context.addIssue({ code: 'custom', message: 'A provided usage value must include a number', path: ['value'] });
    }
    if (value.state !== 'PROVIDED' && value.value !== null) {
      context.addIssue({ code: 'custom', message: 'An unavailable usage value must remain null', path: ['value'] });
    }
  });
export type ModelRuntimeUsageValue = z.infer<typeof modelRuntimeUsageValueSchema>;

export const modelRuntimeTokenUsageSchema = z
  .object({
    inputTokens: modelRuntimeUsageValueSchema,
    cachedInputTokens: modelRuntimeUsageValueSchema,
    outputTokens: modelRuntimeUsageValueSchema,
    reasoningTokens: modelRuntimeUsageValueSchema,
    totalTokens: modelRuntimeUsageValueSchema,
  })
  .strict();
export type ModelRuntimeTokenUsage = z.infer<typeof modelRuntimeTokenUsageSchema>;

export const modelRuntimeExternalReferencesSchema = z
  .object({
    providerRequestId: identifierSchema.nullable(),
    remoteOperationId: identifierSchema.nullable(),
  })
  .strict();
export type ModelRuntimeExternalReferences = z.infer<typeof modelRuntimeExternalReferencesSchema>;

export interface ModelRuntimeAdapterResult {
  output: unknown;
  actualModelId: string | null;
  usage: ModelRuntimeTokenUsage;
  externalReferences: ModelRuntimeExternalReferences;
}

export const modelRuntimeCallPhaseSchema = z.enum([
  'QUEUED',
  'PREPARING_INPUT',
  'BINDING_CONNECTION',
  'SENDING',
  'PROVIDER_ACTIVE',
  'VALIDATING_ENVELOPE',
  'VALIDATING_OUTPUT',
  'COMMIT_READY',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'NOT_STARTED',
]);
export type ModelRuntimeCallPhase = z.infer<typeof modelRuntimeCallPhaseSchema>;

export interface ModelRuntimeCallEvent {
  callId: string;
  taskId: string | null;
  phase: ModelRuntimeCallPhase;
  occurredAt: string;
  routeId: string;
  providerId: string;
  requestedModelId: string;
  providerStarted: boolean;
}

export interface ModelRuntimeCallResult<T> {
  callId: string;
  taskId: string | null;
  route: ModelRuntimeRouteSnapshot;
  inputManifest: ModelRuntimeInputManifest;
  output: T;
  requestedModelId: string;
  actualModelId: string;
  usage: ModelRuntimeTokenUsage;
  externalReferences: ModelRuntimeExternalReferences;
}
