import { CODEX_APP_SERVER_IMAGE_MODEL_KEY, OPENAI_IMAGE_MODEL_KEY } from '@/shared/extension-ids';

/**
 * Existing dictionary expressions are keyed by this profile. Keeping the
 * profile identity separate from route and provider-model identities lets a
 * route opt into a different prompt dialect without changing its route ID.
 */
export const DEFAULT_IMAGE_PROMPT_PROFILE_ID = 'gpt-image-2';

interface PromptProfileRoute {
  key: string;
  modelId: string;
  executionIdentity?: { promptProfileId?: string | null } | null;
}

export function imageGenerationPromptProfileId(route: PromptProfileRoute | null | undefined) {
  const explicit = route?.executionIdentity?.promptProfileId?.trim();
  if (explicit) return explicit;

  // Preserve the pre-profile lookup contract for old snapshots and lightweight
  // routes: App Server and OpenAI are aliases for the GPT Image 2 dialect;
  // every other route historically looked expressions up by its route key.
  const routeKey = route?.key.trim();
  if (routeKey === CODEX_APP_SERVER_IMAGE_MODEL_KEY || routeKey === OPENAI_IMAGE_MODEL_KEY) {
    return DEFAULT_IMAGE_PROMPT_PROFILE_ID;
  }
  return routeKey || route?.modelId.trim() || DEFAULT_IMAGE_PROMPT_PROFILE_ID;
}
