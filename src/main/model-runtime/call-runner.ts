import { randomUUID } from 'node:crypto';
import { modelRuntimeCapabilitiesCover, modelRuntimeInputMismatches } from '@/main/model-runtime/capabilities';
import {
  modelRuntimeCapabilitiesSchema,
  modelRuntimeExternalReferencesSchema,
  modelRuntimeInputManifestSchema,
  modelRuntimeRouteSnapshotSchema,
  modelRuntimeTaskRequirementSchema,
  modelRuntimeTokenUsageSchema,
  type ModelRuntimeAdapterResult,
  type ModelRuntimeCallEvent,
  type ModelRuntimeCallPhase,
  type ModelRuntimeCallResult,
  type ModelRuntimeCapabilities,
  type ModelRuntimeRouteSnapshot,
  type ModelRuntimeTaskRequirement,
} from '@/main/model-runtime/contracts';
import { ModelRuntimeError, normalizeModelRuntimeError, type ModelRuntimeErrorCode } from '@/main/model-runtime/errors';

export interface ModelRuntimeBoundCall {
  execute(context: { signal?: AbortSignal }): Promise<ModelRuntimeAdapterResult>;
}

export type ModelRuntimePreflightResult =
  | { status: 'READY' | 'UNKNOWN' }
  | {
      status: 'BLOCKED';
      code: ModelRuntimeErrorCode;
      message: string;
      retryable: boolean;
    };

export interface RunModelRuntimeCallOptions<T> {
  taskId?: string | null;
  route: unknown;
  requirement: unknown;
  inputManifest: unknown;
  signal?: AbortSignal;
  preflight?: () => ModelRuntimePreflightResult;
  bind: (route: ModelRuntimeRouteSnapshot) => ModelRuntimeBoundCall;
  decodeOutput: (value: unknown) => T;
  resolveActualModelEffectiveCapabilities?: (modelId: string) => unknown;
  observer?: (event: ModelRuntimeCallEvent) => void;
}

function issueSummary(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}: ${issue.message}`)
    .join('; ')
    .slice(0, 800);
}

function invalidRequest(message: string, cause?: unknown) {
  return new ModelRuntimeError({
    code: 'INVALID_REQUEST',
    phase: 'PREPARING_INPUT',
    retryable: false,
    providerStarted: false,
    message,
    cause,
  });
}

function parseCallBoundary(options: RunModelRuntimeCallOptions<unknown>) {
  const route = modelRuntimeRouteSnapshotSchema.safeParse(options.route);
  if (!route.success) throw invalidRequest(`Invalid model route snapshot: ${issueSummary(route.error)}`, route.error);
  const requirement = modelRuntimeTaskRequirementSchema.safeParse(options.requirement);
  if (!requirement.success) {
    throw invalidRequest(`Invalid model task requirement: ${issueSummary(requirement.error)}`, requirement.error);
  }
  const inputManifest = modelRuntimeInputManifestSchema.safeParse(options.inputManifest);
  if (!inputManifest.success) {
    throw invalidRequest(`Invalid model input manifest: ${issueSummary(inputManifest.error)}`, inputManifest.error);
  }
  if (route.data.operation !== requirement.data.operation) {
    throw invalidRequest(
      `Route operation ${route.data.operation} does not match task operation ${requirement.data.operation}`,
    );
  }
  const mismatches = modelRuntimeInputMismatches(
    route.data.effectiveCapabilities,
    requirement.data,
    inputManifest.data,
  );
  if (mismatches.length > 0) {
    throw new ModelRuntimeError({
      code: 'UNSUPPORTED_CAPABILITY',
      phase: 'PREPARING_INPUT',
      retryable: false,
      providerStarted: false,
      message: `Model route does not support ${mismatches.map((entry) => entry.required).join(', ')}`,
    });
  }
  return { route: route.data, requirement: requirement.data, inputManifest: inputManifest.data };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function');
}

function adapterResult(value: ModelRuntimeAdapterResult) {
  if (!value || typeof value !== 'object') {
    throw new ModelRuntimeError({
      code: 'PROVIDER_PROTOCOL_ERROR',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: 'Model adapter returned an invalid result envelope',
    });
  }
  if (
    value.output === null ||
    value.output === undefined ||
    (typeof value.output === 'string' && !value.output.trim())
  ) {
    throw new ModelRuntimeError({
      code: 'NO_OUTPUT',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: 'Model provider returned no output',
    });
  }
  const usage = modelRuntimeTokenUsageSchema.safeParse(value.usage);
  if (!usage.success) {
    throw new ModelRuntimeError({
      code: 'PROVIDER_PROTOCOL_ERROR',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: `Model adapter returned invalid usage metadata: ${issueSummary(usage.error)}`,
      cause: usage.error,
    });
  }
  const externalReferences = modelRuntimeExternalReferencesSchema.safeParse(value.externalReferences);
  if (!externalReferences.success) {
    throw new ModelRuntimeError({
      code: 'PROVIDER_PROTOCOL_ERROR',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: `Model adapter returned invalid external references: ${issueSummary(externalReferences.error)}`,
      cause: externalReferences.error,
    });
  }
  const actualModelId = value.actualModelId?.trim() || null;
  if (actualModelId && actualModelId.length > 200) {
    throw new ModelRuntimeError({
      code: 'PROVIDER_PROTOCOL_ERROR',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: 'Model adapter returned an invalid actual model identifier',
    });
  }
  return { output: value.output, usage: usage.data, externalReferences: externalReferences.data, actualModelId };
}

function validateActualModel(
  requestedModelId: string,
  actualModelId: string,
  requirement: ModelRuntimeTaskRequirement,
  resolver: RunModelRuntimeCallOptions<unknown>['resolveActualModelEffectiveCapabilities'],
  result: ReturnType<typeof adapterResult>,
) {
  if (requestedModelId === actualModelId) return;
  const decoded: { success: true; data: ModelRuntimeCapabilities } | { success: false } = resolver
    ? modelRuntimeCapabilitiesSchema.safeParse(resolver(actualModelId))
    : { success: false };
  if (!decoded.success || !modelRuntimeCapabilitiesCover(decoded.data, requirement)) {
    throw new ModelRuntimeError({
      code: 'ACTUAL_MODEL_CAPABILITY_UNVERIFIED',
      phase: 'VALIDATING_ENVELOPE',
      retryable: false,
      providerStarted: true,
      message: `Provider used unverified model ${actualModelId} instead of ${requestedModelId}`,
      usage: result.usage,
      providerRequestId: result.externalReferences.providerRequestId,
      remoteOperationId: result.externalReferences.remoteOperationId,
    });
  }
}

export class ModelRuntimeCallRunner {
  constructor(
    private readonly idFactory: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run<T>(options: RunModelRuntimeCallOptions<T>): Promise<ModelRuntimeCallResult<T>> {
    const callId = this.idFactory();
    const taskId = options.taskId?.trim() || null;
    const boundary = parseCallBoundary(options);
    let phase: ModelRuntimeCallPhase = 'QUEUED';
    let providerStarted = false;
    const emit = (nextPhase: ModelRuntimeCallPhase) => {
      phase = nextPhase;
      if (!options.observer) return;
      try {
        options.observer({
          callId,
          taskId,
          phase,
          occurredAt: this.now().toISOString(),
          routeId: boundary.route.routeId,
          providerId: boundary.route.providerId,
          requestedModelId: boundary.route.modelId,
          providerStarted,
        });
      } catch {
        // Observability cannot change the result of a provider call.
      }
    };

    emit('QUEUED');
    try {
      emit('PREPARING_INPUT');
      if (options.signal?.aborted) {
        throw new ModelRuntimeError({
          code: 'CANCELLED',
          phase,
          retryable: false,
          providerStarted: false,
          message: 'Model call was cancelled before it started',
        });
      }
      const preflight = options.preflight?.() ?? { status: 'UNKNOWN' as const };
      if (preflight.status === 'BLOCKED') {
        throw new ModelRuntimeError({
          code: preflight.code,
          phase,
          retryable: preflight.retryable,
          providerStarted: false,
          message: preflight.message,
        });
      }

      emit('BINDING_CONNECTION');
      const bound = options.bind(boundary.route);
      if (isPromiseLike(bound) || !bound || typeof bound.execute !== 'function') {
        throw invalidRequest('Model adapter binding must synchronously return an executable bound call');
      }

      emit('SENDING');
      providerStarted = true;
      const execution = bound.execute({ signal: options.signal });
      emit('PROVIDER_ACTIVE');
      const providerResult = await execution;
      emit('VALIDATING_ENVELOPE');
      const normalized = adapterResult(providerResult);
      const actualModelId = normalized.actualModelId ?? boundary.route.modelId;
      validateActualModel(
        boundary.route.modelId,
        actualModelId,
        boundary.requirement,
        options.resolveActualModelEffectiveCapabilities,
        normalized,
      );

      emit('VALIDATING_OUTPUT');
      let output: T;
      try {
        output = options.decodeOutput(normalized.output);
      } catch (error) {
        throw new ModelRuntimeError({
          code: 'OUTPUT_INVALID',
          phase: 'VALIDATING_OUTPUT',
          retryable: false,
          providerStarted: true,
          message: error instanceof Error ? error.message : 'Model output failed business validation',
          usage: normalized.usage,
          providerRequestId: normalized.externalReferences.providerRequestId,
          remoteOperationId: normalized.externalReferences.remoteOperationId,
          cause: error,
        });
      }
      emit('COMMIT_READY');
      const result: ModelRuntimeCallResult<T> = {
        callId,
        taskId,
        route: boundary.route,
        inputManifest: boundary.inputManifest,
        output,
        requestedModelId: boundary.route.modelId,
        actualModelId,
        usage: normalized.usage,
        externalReferences: normalized.externalReferences,
      };
      emit('SUCCEEDED');
      return result;
    } catch (error) {
      const normalized = normalizeModelRuntimeError(error, {
        phase,
        providerStarted,
        signal: options.signal,
      });
      providerStarted = normalized.providerStarted;
      emit(normalized.code === 'CANCELLED' ? 'CANCELLED' : providerStarted ? 'FAILED' : 'NOT_STARTED');
      throw normalized;
    }
  }
}
