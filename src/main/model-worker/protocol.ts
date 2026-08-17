import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import type {
  AssistantActivityEventDto,
  CodexHealth,
  GenerationChangedEvent,
  ImageGenerationRouteDto,
  GenerationTaskDto,
} from '@/shared/contracts';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';

// The wire version tracks message compatibility. The runtime fingerprint
// separately prevents a host from reusing worker code from another build.
export const MODEL_WORKER_PROTOCOL_VERSION = 1;
export const MODEL_WORKER_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export const modelWorkerMethods = [
  'snapshot',
  'library-file-view.refresh',
  'dictionary.stage-import',
  'dictionary.commit-import',
  'image-transform.crop',
  'generation.start',
  'generation.start-batch',
  'generation.start-image-edit',
  'generation.start-image-edit-batch',
  'generation.start-image-reframe',
  'generation.start-codex-image-refinement',
  'generation.start-style-exploration',
  'generation.cancel-style-exploration',
  'generation.retry-style-exploration-slot',
  'generation.start-version',
  'generation.retry',
  'generation.cancel',
  'generation.configure-concurrency',
  'codex.refresh-health',
  'codex.list-models',
  'video-document.article-generate',
  'video-document.transcript-translate',
  'assistant.run',
  'assistant.suggest-titles',
  'codex.chat',
  'codex.suggest-titles',
  'codex.cancel-all',
  'extensions.refresh',
  'extensions.configure-openai-image-api',
  'extensions.configure-deepseek-api',
  'extensions.configure-external-image-apis',
  'worker.shutdown',
  'worker.shutdown-when-idle',
  'worker.force-shutdown',
] as const;

export type ModelWorkerMethod = (typeof modelWorkerMethods)[number];

export interface ModelWorkerSnapshot {
  protocolVersion: number;
  runtimeFingerprint: string;
  workerId: string;
  codexHealth: CodexHealth;
  codexPendingCount: number;
  imageGenerationRoutes: ImageGenerationRouteDto[];
  generationTasks: GenerationTaskDto[];
}

export interface ModelWorkerLaunchConfig {
  protocolVersion: number;
  runtimeFingerprint: string;
  workerId: string;
  token: string;
  endpoint: string;
  descriptorPath: string;
  errorPath: string;
  databasePath: string;
  libraryRoot: string;
  imageTransformWorkerPath: string;
  internalModelsEnabled: boolean;
  idleExitMs: number;
}

export interface ModelWorkerDescriptor {
  protocolVersion: number;
  runtimeFingerprint: string;
  workerId: string;
  token: string;
  endpoint: string;
  pid: number;
  startedAt: string;
}

export interface ModelWorkerStartupError {
  workerId: string;
  message: string;
  code?: string;
  stack?: string;
  failedAt?: string;
}

export type ModelWorkerClientMessage =
  | {
      type: 'hello';
      protocolVersion: number;
      token: string;
      clientId: string;
    }
  | {
      type: 'request';
      id: string;
      method: ModelWorkerMethod;
      params: unknown[];
    }
  | {
      type: 'cancel';
      id: string;
    };

export type ModelWorkerServerMessage =
  | { type: 'ready'; snapshot: ModelWorkerSnapshot }
  | { type: 'response'; id: string; result: unknown }
  | { type: 'response'; id: string; error: { message: string; code?: string } }
  | { type: 'generation-changed'; event: GenerationChangedEvent }
  | { type: 'assistant-progress'; event: AssistantActivityEventDto }
  | { type: 'snapshot'; snapshot: ModelWorkerSnapshot }
  | { type: 'protocol-error'; message: string };

const boundedIdentifier = z.string().min(1).max(512);
const boundedText = z.string().max(100_000);
const runtimeFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const tokenSchema = z.string().regex(/^[a-f0-9]{64,256}$/i);
const pathOrEndpointSchema = z.string().min(1).max(32_768);
const protocolVersionSchema = z.number().int().positive();
const modelWorkerMethodSchema = z.enum(modelWorkerMethods);

const codexHealthSchema: z.ZodType<CodexHealth> = z
  .object({
    state: z.enum(['checking', 'ready', 'unavailable']),
    version: z.string().max(1_000),
    authenticated: z.boolean(),
    message: z.string().max(10_000),
  })
  .strict();

const imageGenerationRouteSchema: z.ZodType<ImageGenerationRouteDto> = z
  .object({
    key: boundedIdentifier,
    name: z.string().min(1).max(1_000),
    provider: z.string().min(1).max(1_000),
    providerKey: boundedIdentifier,
    modelId: boundedIdentifier,
    executionIdentity: z
      .object({
        routeId: boundedIdentifier,
        providerId: boundedIdentifier,
        connectionId: boundedIdentifier,
        adapterId: boundedIdentifier,
        modelId: boundedIdentifier,
        canonicalModelFamilyId: boundedIdentifier.nullable(),
        promptProfileId: boundedIdentifier.optional(),
        resourcePoolKey: boundedIdentifier,
        // Earlier worker snapshots may contain these two fields. Decode and
        // discard them; neither field participates in admission anymore.
        providerMaxConcurrent: z.number().int().positive().max(1_000).nullable().optional(),
        resourcePoolMaxConcurrent: z.number().int().positive().max(1_000).nullable().optional(),
      })
      .strict()
      .transform((identity) => ({
        routeId: identity.routeId,
        providerId: identity.providerId,
        connectionId: identity.connectionId,
        adapterId: identity.adapterId,
        modelId: identity.modelId,
        canonicalModelFamilyId: identity.canonicalModelFamilyId,
        promptProfileId: identity.promptProfileId,
        resourcePoolKey: identity.resourcePoolKey,
      }))
      .optional(),
    maxConcurrent: z.number().int().positive().max(100).optional(),
    state: z.enum(['READY', 'UNAVAILABLE']),
    availabilityReason: z.string().max(10_000).nullable(),
    releaseStage: z.enum(['STABLE', 'PREVIEW', 'INTERNAL']),
    internal: z.boolean(),
    maxReferenceImages: z.number().int().nonnegative().max(1_000).nullable(),
    capabilities: z
      .array(
        z.enum(['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT', 'MASK_EDIT', 'TRANSPARENT_BACKGROUND']),
      )
      .max(20),
    qualityMode: z.enum(['SELECTABLE', 'PROVIDER_MANAGED']),
    supportedQualities: z.array(z.enum(['low', 'medium', 'high'])).max(3),
  })
  .strict()
  .transform((route): ImageGenerationRouteDto => {
    if (!route.executionIdentity) return { ...route, executionIdentity: undefined };
    return {
      ...route,
      executionIdentity: {
        ...route.executionIdentity,
        promptProfileId: imageGenerationPromptProfileId(route),
      },
    };
  });

const generationTaskSchema: z.ZodType<GenerationTaskDto> = z
  .object({
    runId: boundedIdentifier,
    seriesId: boundedIdentifier,
    versionId: boundedIdentifier,
    modelKey: boundedIdentifier,
    batchId: boundedIdentifier.nullable().optional(),
    batchPosition: z.number().int().nonnegative().nullable().optional(),
    batchTotal: z.number().int().nonnegative().nullable().optional(),
    batchModelKeys: z.array(boundedIdentifier).max(1_000).optional(),
    status: z.enum(['QUEUED', 'RUNNING']),
    phase: z.enum([
      'QUEUED',
      'PREPARING',
      'SUBMITTING',
      'UPLOADING',
      'WAITING_PROVIDER',
      'GENERATING',
      'DOWNLOADING',
      'FINALIZING',
      'SAVING',
      'RECOVERING',
      'CANCELLING',
    ]),
    progress: z.number().min(0).max(1).nullable(),
    queuePosition: z.number().int().nonnegative().nullable(),
    submittedAt: z.string().min(1).max(100),
    startedAt: z.string().min(1).max(100).nullable(),
    updatedAt: z.string().min(1).max(100),
  })
  .strict();

const generationChangedEventSchema: z.ZodType<GenerationChangedEvent> = z
  .object({
    runId: z.string().max(512),
    tasks: z.array(generationTaskSchema).max(10_000),
    terminal: z.boolean(),
  })
  .strict();

const assistantActivityEventSchema: z.ZodType<AssistantActivityEventDto> = z
  .object({
    id: boundedIdentifier,
    creationId: boundedIdentifier,
    assistantRunId: boundedIdentifier.nullable(),
    scope: z.object({ kind: z.enum(['DRAFT', 'SERIES']), id: boundedIdentifier }).strict(),
    contextKey: boundedIdentifier,
    sequence: z.number().int().nonnegative(),
    phase: z.enum([
      'CREATION_SAVED',
      'MODEL_REQUESTED',
      'MODEL_RESPONDING',
      'RESULT_VALIDATED',
      'COMPLETED',
      'FAILED',
      'INTERRUPTED',
    ]),
    providerKey: boundedIdentifier.nullable(),
    modelKey: boundedIdentifier.nullable(),
    message: z.string().max(100_000),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1).max(100),
  })
  .strict();

const modelWorkerSnapshotSchema: z.ZodType<ModelWorkerSnapshot> = z
  .object({
    protocolVersion: protocolVersionSchema,
    runtimeFingerprint: runtimeFingerprintSchema,
    workerId: boundedIdentifier,
    codexHealth: codexHealthSchema,
    codexPendingCount: z.number().int().nonnegative().max(100_000),
    imageGenerationRoutes: z.array(imageGenerationRouteSchema).max(10_000),
    generationTasks: z.array(generationTaskSchema).max(10_000),
  })
  .strict();

const modelWorkerLaunchConfigSchema: z.ZodType<ModelWorkerLaunchConfig> = z
  .object({
    protocolVersion: z.literal(MODEL_WORKER_PROTOCOL_VERSION),
    runtimeFingerprint: runtimeFingerprintSchema,
    workerId: boundedIdentifier,
    token: tokenSchema,
    endpoint: pathOrEndpointSchema,
    descriptorPath: pathOrEndpointSchema,
    errorPath: pathOrEndpointSchema,
    databasePath: pathOrEndpointSchema,
    libraryRoot: pathOrEndpointSchema,
    imageTransformWorkerPath: pathOrEndpointSchema,
    internalModelsEnabled: z.boolean(),
    idleExitMs: z
      .number()
      .int()
      .min(1_000)
      .max(7 * 24 * 60 * 60 * 1_000),
  })
  .strict();

const modelWorkerDescriptorSchema: z.ZodType<ModelWorkerDescriptor> = z
  .object({
    protocolVersion: protocolVersionSchema,
    runtimeFingerprint: runtimeFingerprintSchema,
    workerId: boundedIdentifier,
    token: tokenSchema,
    endpoint: pathOrEndpointSchema,
    pid: z.number().int().positive(),
    startedAt: z.string().min(1).max(100),
  })
  .strict();

const modelWorkerStartupErrorSchema: z.ZodType<ModelWorkerStartupError> = z
  .object({
    workerId: boundedIdentifier,
    message: z.string().min(1).max(100_000),
    code: z.string().min(1).max(512).optional(),
    stack: z.string().max(100_000).optional(),
    failedAt: z.string().min(1).max(100).optional(),
  })
  .strict();

const modelWorkerErrorTargetSchema = z
  .object({
    workerId: boundedIdentifier,
    errorPath: pathOrEndpointSchema,
  })
  .passthrough();

const modelWorkerClientMessageSchema: z.ZodType<ModelWorkerClientMessage> = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      protocolVersion: protocolVersionSchema,
      token: tokenSchema,
      clientId: boundedIdentifier,
    })
    .strict(),
  z
    .object({
      type: z.literal('request'),
      id: boundedIdentifier,
      method: modelWorkerMethodSchema,
      params: z.array(z.unknown()).max(100),
    })
    .strict(),
  z.object({ type: z.literal('cancel'), id: boundedIdentifier }).strict(),
]);

const modelWorkerServerMessageSchema: z.ZodType<ModelWorkerServerMessage> = z.union([
  z.object({ type: z.literal('ready'), snapshot: modelWorkerSnapshotSchema }).strict(),
  z.object({ type: z.literal('response'), id: boundedIdentifier, result: z.unknown() }).strict(),
  z
    .object({
      type: z.literal('response'),
      id: boundedIdentifier,
      error: z.object({ message: boundedText, code: z.string().max(512).optional() }).strict(),
    })
    .strict(),
  z.object({ type: z.literal('generation-changed'), event: generationChangedEventSchema }).strict(),
  z.object({ type: z.literal('assistant-progress'), event: assistantActivityEventSchema }).strict(),
  z.object({ type: z.literal('snapshot'), snapshot: modelWorkerSnapshotSchema }).strict(),
  z.object({ type: z.literal('protocol-error'), message: boundedText }).strict(),
]);

function parseJson(raw: string, invalidMessage: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(invalidMessage);
  }
}

function createWorkerMessageDecoder<T>(schema: z.ZodType<T>, onMessage: (message: T) => void) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > MODEL_WORKER_MAX_MESSAGE_BYTES) {
        throw new Error('Background model service sent an oversized message');
      }
      const parsed = schema.safeParse(parseJson(line, 'Background model service sent malformed JSON'));
      if (!parsed.success) throw new Error('Background model service sent an invalid protocol message');
      onMessage(parsed.data);
    }
    if (Buffer.byteLength(buffer, 'utf8') > MODEL_WORKER_MAX_MESSAGE_BYTES) {
      throw new Error('Background model service sent an oversized message');
    }
  };
}

export function createModelWorkerClientMessageDecoder(onMessage: (message: ModelWorkerClientMessage) => void) {
  return createWorkerMessageDecoder(modelWorkerClientMessageSchema, onMessage);
}

export function createModelWorkerServerMessageDecoder(onMessage: (message: ModelWorkerServerMessage) => void) {
  return createWorkerMessageDecoder(modelWorkerServerMessageSchema, onMessage);
}

export function encodeWorkerMessage(message: ModelWorkerClientMessage | ModelWorkerServerMessage) {
  return `${JSON.stringify(message)}\n`;
}

export function parseModelWorkerLaunchConfig(raw: string | undefined): ModelWorkerLaunchConfig {
  if (!raw) throw new Error('Background model service launch configuration is missing');
  const parsed = modelWorkerLaunchConfigSchema.safeParse(
    parseJson(raw, 'Background model service launch configuration is malformed'),
  );
  if (!parsed.success) throw new Error('Background model service launch configuration is invalid');
  return parsed.data;
}

export function parseModelWorkerDescriptor(raw: string): ModelWorkerDescriptor | null {
  const parsed = modelWorkerDescriptorSchema.safeParse(
    parseJson(raw, 'Background model service descriptor is malformed'),
  );
  return parsed.success ? parsed.data : null;
}

export function parseModelWorkerStartupError(raw: string): ModelWorkerStartupError | null {
  const parsed = modelWorkerStartupErrorSchema.safeParse(
    parseJson(raw, 'Background model service startup error is malformed'),
  );
  return parsed.success ? parsed.data : null;
}

export function parseModelWorkerErrorTarget(raw: string | undefined) {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = modelWorkerErrorTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
