import type { LocalSpaceMigrationErrorCode } from '@/shared/contracts/local-space';

export class LocalSpaceMigrationFailure extends Error {
  constructor(
    readonly code: LocalSpaceMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LocalSpaceMigrationFailure';
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
