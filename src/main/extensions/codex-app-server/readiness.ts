import {
  evaluateCodexAppServerReadiness,
  type CodexAppServerAccountReadResult,
  type CodexAppServerModelCatalogEntry,
  type CodexAppServerRateLimits,
  type CodexAppServerReadiness,
  type CodexAppServerReadinessDiagnostic,
} from '@/main/extensions/codex-app-server/protocol';
import type { AssistantReasoningEffort } from '@/shared/contracts';

export interface CodexAppServerPreflightInput {
  model: string;
  effort: AssistantReasoningEffort;
}

export interface CodexAppServerModelCatalogResult {
  entries: CodexAppServerModelCatalogEntry[];
  complete: boolean;
}

interface ReadinessProbeResult<T> {
  succeeded: boolean;
  value: T | null;
  diagnostic: CodexAppServerReadinessDiagnostic | null;
}

export interface CodexAppServerReadinessSource {
  readAccount(): Promise<CodexAppServerAccountReadResult>;
  readModelCatalog(): Promise<CodexAppServerModelCatalogResult>;
  readRateLimits(): Promise<CodexAppServerRateLimits>;
  getCachedRateLimits(): CodexAppServerRateLimits | null;
  hasInvalidRateLimitsNotification(): boolean;
}

function rpcCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('rpcCode' in error)) return undefined;
  const value = error.rpcCode;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

async function captureReadinessProbe<T>(
  probe: CodexAppServerReadinessDiagnostic['probe'],
  operation: () => Promise<T>,
): Promise<ReadinessProbeResult<T>> {
  try {
    return { succeeded: true, value: await operation(), diagnostic: null };
  } catch (error) {
    const code = rpcCode(error);
    const diagnostic: CodexAppServerReadinessDiagnostic = {
      probe,
      code:
        code !== undefined
          ? 'RPC_ERROR'
          : error instanceof Error && error.message.includes('invalid result')
            ? 'INVALID_RESPONSE'
            : error instanceof Error && error.message.includes('timed out')
              ? 'RPC_TIMEOUT'
              : 'PROBE_UNAVAILABLE',
    };
    if (code !== undefined) diagnostic.rpcCode = code;
    return { succeeded: false, value: null, diagnostic };
  }
}

export async function preflightCodexAppServer(
  input: CodexAppServerPreflightInput,
  source: CodexAppServerReadinessSource,
): Promise<CodexAppServerReadiness> {
  const [accountProbe, modelCatalogProbe, rateLimitsProbe] = await Promise.all([
    captureReadinessProbe('ACCOUNT', source.readAccount),
    captureReadinessProbe('MODEL_CATALOG', source.readModelCatalog),
    captureReadinessProbe('RATE_LIMITS', source.readRateLimits),
  ]);
  const diagnostics = [accountProbe.diagnostic, modelCatalogProbe.diagnostic, rateLimitsProbe.diagnostic].filter(
    (entry): entry is CodexAppServerReadinessDiagnostic => entry !== null,
  );
  if (source.hasInvalidRateLimitsNotification()) {
    diagnostics.push({ probe: 'RATE_LIMITS', code: 'INVALID_UPDATE_NOTIFICATION' });
  }
  const catalog = modelCatalogProbe.value;
  return evaluateCodexAppServerReadiness({
    model: input.model,
    effort: input.effort,
    account: accountProbe.value,
    accountProbeSucceeded: accountProbe.succeeded,
    models: catalog?.entries ?? [],
    modelCatalogProbeSucceeded: modelCatalogProbe.succeeded,
    modelCatalogComplete: catalog?.complete ?? false,
    rateLimits: rateLimitsProbe.value ?? source.getCachedRateLimits(),
    rateLimitsProbeSucceeded: rateLimitsProbe.succeeded,
    diagnostics,
  });
}
