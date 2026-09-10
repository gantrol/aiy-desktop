import {
  agentMessageCompletedItemSchema,
  imageGenerationCompletedItemSchema,
} from '@/main/extensions/codex-app-server/protocol';
import type { CodexAppServerImageResult } from '@/main/extensions/codex-app-server/client';

export function captureCodexCompletedItem(
  item: Record<string, unknown>,
  tracker: { finalMessage: string; image: CodexAppServerImageResult | null; images: CodexAppServerImageResult[] },
) {
  if (item.type === 'agentMessage') {
    const parsed = agentMessageCompletedItemSchema.safeParse(item);
    if (!parsed.success) return true;
    if (parsed.data.phase === 'final_answer' || !tracker.finalMessage) tracker.finalMessage = parsed.data.text;
    return true;
  }
  if (item.type === 'imageGeneration') {
    const parsed = imageGenerationCompletedItemSchema.safeParse(item);
    if (!parsed.success) return true;
    const image = {
      status: parsed.data.status,
      failure: parsed.data.failure,
      savedPath: parsed.data.savedPath ?? null,
      revisedPrompt: parsed.data.revisedPrompt ?? null,
      result: parsed.data.result ?? '',
    };
    // A later failed attempt must not discard an earlier successful image.
    const usable = (value: CodexAppServerImageResult | null) =>
      value &&
      !value.failure &&
      !['failed', 'cancelled'].includes(value.status ?? '') &&
      Boolean(value.savedPath || value.result.trim());
    if (usable(image) || !usable(tracker.image)) tracker.image = image;
    if (!tracker.images.some((previous) => previous.savedPath === image.savedPath && previous.result === image.result))
      tracker.images.push(image);
    return true;
  }
  return false;
}
