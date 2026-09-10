import type { CodexAppServerImageResult } from '@/main/extensions/codex-app-server/client';

/** Preserve provider failures before attempting to read or decode an image. */
export function codexImageOutputError(image: CodexAppServerImageResult | null, finalMessage: string) {
  const failure = image?.failure;
  const details = failure && typeof failure === 'object' ? (failure as Record<string, unknown>) : null;
  const providerCode = typeof details?.code === 'string' ? details.code : null;
  const providerMessage = typeof details?.message === 'string' ? details.message : null;
  const code =
    image?.status === 'cancelled'
      ? 'IMAGE_GENERATION_CANCELLED'
      : providerCode === 'moderation_blocked'
        ? 'IMAGE_GENERATION_BLOCKED'
        : image?.status === 'failed' || failure
          ? 'IMAGE_GENERATION_TOOL_FAILED'
          : 'IMAGE_GENERATION_NO_OUTPUT';
  return Object.assign(
    new Error(
      (providerMessage || (typeof failure === 'string' ? failure : '') || finalMessage.trim() || code).slice(0, 4000),
    ),
    { code },
  );
}
