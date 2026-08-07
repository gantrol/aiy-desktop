import type { GenerationRunDto } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()))]
    .filter(Boolean)
    .slice(0, 20);
}

function legacyModerationCategories(message: string | null) {
  const match = message?.match(/safety_violations\s*=\s*\[([^\]]*)\]/i);
  if (!match) return [];
  return [
    ...new Set(
      match[1]
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean),
    ),
  ];
}

function requestIdFromMessage(message: string | null) {
  return message?.match(/\breq_[A-Za-z0-9_-]+\b/)?.[0] ?? null;
}

export interface GenerationErrorPresentation {
  summary: string;
  detailsText: string;
  moderation: boolean;
}

type ErrorRun = Pick<
  GenerationRunDto,
  'status' | 'errorCode' | 'errorMessage' | 'errorDetails' | 'providerRequestId' | 'id' | 'modelKey'
>;

interface ModerationContext {
  moderation: boolean;
  stage: string | null;
  categories: string[];
}

function moderationContext(run: ErrorRun, metadata: Record<string, unknown>): ModerationContext {
  const stage = stringValue(metadata.moderationStage) ?? stringValue(metadata.moderation_stage) ?? null;
  const reportedCategories = [...stringArray(metadata.moderationCategories), ...stringArray(metadata.categories)];
  const categories = [...new Set([...reportedCategories, ...legacyModerationCategories(run.errorMessage)])];
  const moderation =
    run.errorCode === 'SAFETY' ||
    run.errorDetails?.providerCode === 'moderation_blocked' ||
    /moderation[_ -]?blocked|safety system|safety_violations|content (?:policy|review)/i.test(run.errorMessage ?? '');
  return { moderation, stage, categories };
}

function summaryFor(run: ErrorRun, copy: MessageCatalog['app']['generationErrors'], moderation: ModerationContext) {
  if (moderation.moderation) {
    if (moderation.stage === 'input') return copy.summaries.moderationInput;
    if (moderation.stage === 'output') return copy.summaries.moderationOutput;
    return copy.summaries.moderation;
  }
  if (run.status === 'INTERRUPTED') return copy.summaries.interrupted;
  return (
    {
      AUTH: copy.summaries.auth,
      RATE_LIMITED: copy.summaries.rateLimited,
      NETWORK: copy.summaries.network,
      PROVIDER_UNAVAILABLE: copy.summaries.unavailable,
      INVALID_REQUEST: copy.summaries.invalidRequest,
      UNSUPPORTED_CAPABILITY: copy.summaries.invalidRequest,
      NO_OUTPUT: copy.summaries.noOutput,
      LOCAL_STATE: copy.summaries.localState,
      OUTPUT_COMMIT_FAILED: copy.summaries.localState,
    }[run.errorCode ?? ''] ?? copy.summaries.generic
  );
}

function detailRecord(run: ErrorRun, metadata: Record<string, unknown>, moderation: ModerationContext) {
  const providerCode = run.errorDetails?.providerCode ?? null;
  const requestId = run.providerRequestId ?? stringValue(metadata.requestId) ?? requestIdFromMessage(run.errorMessage);
  const providerType = stringValue(metadata.providerType);
  return {
    run_id: run.id,
    model_key: run.modelKey,
    status: run.status,
    ...(run.errorMessage ? { message: run.errorMessage } : {}),
    ...(run.errorCode ? { error_code: run.errorCode } : {}),
    ...(providerCode ? { provider_code: providerCode } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(typeof metadata.httpStatus === 'number' ? { http_status: metadata.httpStatus } : {}),
    ...(providerType ? { provider_type: providerType } : {}),
    ...(Object.prototype.hasOwnProperty.call(metadata, 'providerParam')
      ? { provider_param: metadata.providerParam }
      : {}),
    ...(run.errorDetails ? { retryable: run.errorDetails.retryable } : {}),
    ...(moderation.moderation
      ? {
          moderation_stage:
            moderation.stage === 'input' || moderation.stage === 'output' || moderation.stage === 'unknown'
              ? moderation.stage
              : 'unknown',
          categories: moderation.categories,
        }
      : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function generationErrorPresentation(run: ErrorRun, messages: MessageCatalog): GenerationErrorPresentation {
  const copy = messages.app.generationErrors;
  const metadata = run.errorDetails?.metadata ?? {};
  const moderation = moderationContext(run, metadata);
  const details = detailRecord(run, metadata, moderation);

  return {
    summary: summaryFor(run, copy, moderation),
    detailsText: JSON.stringify(details, null, 2),
    moderation: moderation.moderation,
  };
}
