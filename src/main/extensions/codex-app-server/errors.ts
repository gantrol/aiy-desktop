import type { CodexAppServerTokenUsage } from '@/main/extensions/codex-app-server/protocol';

export class CodexAppServerRpcError extends Error {
  constructor(
    message: string,
    readonly rpcCode?: number,
    readonly rpcData?: unknown,
  ) {
    super(message);
    this.name = 'CodexAppServerRpcError';
  }
}

export class CodexAppServerCaptureError extends Error {
  readonly code = 'CAPTURE_DEGRADED';

  constructor(
    readonly degradationReason: string,
    readonly droppedEventCount: number,
    readonly droppedEventCountExact: boolean,
  ) {
    super('Codex App Server observable event capture exceeded a bounded host limit');
    this.name = 'CodexAppServerCaptureError';
  }
}

export class CodexAppServerEmptyResponseError extends Error {
  readonly code = 'EMPTY_RESPONSE' as const;

  constructor(
    readonly threadId: string,
    readonly turnId: string,
    readonly usage: Partial<CodexAppServerTokenUsage> | null,
  ) {
    super('Codex App Server completed the turn without a final response');
    this.name = 'CodexAppServerEmptyResponseError';
  }
}
