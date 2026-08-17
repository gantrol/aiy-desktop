import { z } from 'zod';
import type { ModelRuntimeCallPhase, ModelRuntimeTokenUsage } from '@/main/model-runtime/contracts';
import { unavailableModelRuntimeTokenUsage } from '@/main/model-runtime/usage';

export const modelRuntimeErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'INPUT_TOO_LARGE',
  'INPUT_CHANGED',
  'UNSUPPORTED_CAPABILITY',
  'ROUTE_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'ACTUAL_MODEL_CAPABILITY_UNVERIFIED',
  'CONNECTION_UNAVAILABLE',
  'AUTH_REQUIRED',
  'AUTH_REJECTED',
  'PERMISSION_DENIED',
  'CREDITS_DEPLETED',
  'WORKSPACE_LIMIT',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_PROTOCOL_ERROR',
  'SAFETY_REJECTED',
  'REFUSED',
  'NO_OUTPUT',
  'OUTPUT_INVALID',
  'CANCELLED',
  'INTERRUPTED',
  'UNKNOWN_EXTERNAL_STATE',
  'LOCAL_STATE_ERROR',
  'UNKNOWN',
]);
export type ModelRuntimeErrorCode = z.infer<typeof modelRuntimeErrorCodeSchema>;

export interface ModelRuntimeErrorOptions {
  code: ModelRuntimeErrorCode;
  phase: ModelRuntimeCallPhase;
  retryable: boolean;
  providerStarted: boolean;
  message: string;
  diagnostics?: string | null;
  providerCode?: string | null;
  httpStatus?: number | null;
  providerRequestId?: string | null;
  remoteOperationId?: string | null;
  retryAfter?: string | null;
  resetAt?: string | null;
  usage?: ModelRuntimeTokenUsage;
  cause?: unknown;
}

export class ModelRuntimeError extends Error {
  readonly code: ModelRuntimeErrorCode;
  readonly phase: ModelRuntimeCallPhase;
  readonly retryable: boolean;
  readonly providerStarted: boolean;
  readonly uiMessageKey: string;
  readonly diagnostics: string | null;
  readonly providerCode: string | null;
  readonly httpStatus: number | null;
  readonly providerRequestId: string | null;
  readonly remoteOperationId: string | null;
  readonly retryAfter: string | null;
  readonly resetAt: string | null;
  readonly usage: ModelRuntimeTokenUsage;

  constructor(options: ModelRuntimeErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'ModelRuntimeError';
    this.code = options.code;
    this.phase = options.phase;
    this.retryable = options.retryable;
    this.providerStarted = options.providerStarted;
    this.uiMessageKey = `modelRuntime.error.${options.code.toLowerCase()}`;
    this.diagnostics = boundedDiagnostics(options.diagnostics ?? options.message);
    this.providerCode = boundedIdentifier(options.providerCode);
    this.httpStatus = boundedHttpStatus(options.httpStatus);
    this.providerRequestId = boundedIdentifier(options.providerRequestId);
    this.remoteOperationId = boundedIdentifier(options.remoteOperationId);
    this.retryAfter = boundedDateOrDuration(options.retryAfter);
    this.resetAt = boundedDateOrDuration(options.resetAt);
    this.usage =
      options.usage ?? unavailableModelRuntimeTokenUsage(options.providerStarted ? 'MISSING' : 'NOT_STARTED');
  }
}

function boundedIdentifier(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;
}

function boundedHttpStatus(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function boundedDateOrDuration(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function boundedDiagnostics(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000);
}

function objectProperty(value: unknown, key: string) {
  return value && typeof value === 'object' && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

function errorCode(value: unknown): ModelRuntimeErrorCode | null {
  const decoded = modelRuntimeErrorCodeSchema.safeParse(objectProperty(value, 'code'));
  return decoded.success ? decoded.data : null;
}

function retryableByDefault(code: ModelRuntimeErrorCode) {
  return ['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'INTERRUPTED'].includes(code);
}

export function normalizeModelRuntimeError(
  error: unknown,
  context: {
    phase: ModelRuntimeCallPhase;
    providerStarted: boolean;
    signal?: AbortSignal;
    fallbackCode?: ModelRuntimeErrorCode;
  },
) {
  if (error instanceof ModelRuntimeError) return error;
  const aborted = context.signal?.aborted === true;
  const code = aborted
    ? 'CANCELLED'
    : (errorCode(error) ??
      (error instanceof TypeError && error.message === 'fetch failed'
        ? 'NETWORK_ERROR'
        : (context.fallbackCode ?? 'UNKNOWN')));
  const message = error instanceof Error && error.message.trim() ? error.message : `Model call failed (${code})`;
  const retryable =
    typeof objectProperty(error, 'retryable') === 'boolean'
      ? (objectProperty(error, 'retryable') as boolean)
      : retryableByDefault(code);
  return new ModelRuntimeError({
    code,
    phase: context.phase,
    retryable,
    providerStarted: context.providerStarted,
    message,
    diagnostics: message,
    providerCode: objectProperty(error, 'providerCode') as string | null | undefined,
    httpStatus: objectProperty(error, 'status') as number | null | undefined,
    providerRequestId: objectProperty(error, 'requestId') as string | null | undefined,
    remoteOperationId: objectProperty(error, 'remoteOperationId') as string | null | undefined,
    retryAfter: objectProperty(error, 'retryAfter') as string | null | undefined,
    resetAt: objectProperty(error, 'resetAt') as string | null | undefined,
    cause: error,
  });
}
