import type { LocalSpaceTransferErrorCode } from '@/shared/contracts/local-space';

export class LocalSpaceTransferFailure extends Error {
  constructor(
    readonly code: LocalSpaceTransferErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LocalSpaceTransferFailure';
  }
}

export function isTransferAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
