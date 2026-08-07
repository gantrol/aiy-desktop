export type GenerationAdapterErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_CAPABILITY'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'SAFETY'
  | 'NETWORK'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_PROTOCOL_ERROR'
  | 'CANCELLED'
  | 'NO_OUTPUT'
  | 'LOCAL_STATE'
  | 'UNKNOWN';

export interface GenerationAdapterErrorDto {
  code: GenerationAdapterErrorCode;
  message: string;
  retryable: boolean;
  providerCode?: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface GenerationAdapterErrorOptions {
  code: GenerationAdapterErrorCode;
  message: string;
  retryable?: boolean;
  providerCode?: string;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

const retryableByDefault = new Set<GenerationAdapterErrorCode>([
  'RATE_LIMITED',
  'NETWORK',
  'PROVIDER_UNAVAILABLE',
  'NO_OUTPUT',
]);

export class GenerationAdapterError extends Error {
  readonly code: GenerationAdapterErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: GenerationAdapterErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'GenerationAdapterError';
    this.code = options.code;
    this.retryable = options.retryable ?? retryableByDefault.has(options.code);
    this.providerCode = options.providerCode;
    this.details = options.details;
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function normalizeGenerationAdapterError(error: unknown, aborted = false): GenerationAdapterError {
  if (error instanceof GenerationAdapterError) return error;

  if (aborted || isAbortError(error)) {
    return new GenerationAdapterError({
      code: 'CANCELLED',
      message: 'Generation was cancelled',
      cause: error,
    });
  }

  return new GenerationAdapterError({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown generation adapter error',
    cause: error,
  });
}

export function serializeGenerationAdapterError(error: GenerationAdapterError): GenerationAdapterErrorDto {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}
