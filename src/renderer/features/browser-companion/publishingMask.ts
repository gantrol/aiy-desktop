import type { BrowserCompanionTarget } from '@/shared/contracts';
import {
  publishingMaskErrorSchema,
  publishingMaskFields,
  publishingMaskOverridesForTarget,
  publishingMaskTarget,
  type PublishingMaskSource,
  type PublishingMaskOverrides,
} from '@/shared/contracts/publishing-mask';
import type { MessageCatalog } from '@/renderer/i18n/types';

export function publishingMaskErrorMessage(reason: unknown, messages: MessageCatalog): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const code = publishingMaskErrorSchema.options.find((code) => message.includes(code));
  return messages.publishing.mask.errors[code ?? 'PUBLISHING_MASK_UNAVAILABLE'];
}

export function isPublishingMaskError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return publishingMaskErrorSchema.options.some((code) => message.includes(code));
}

export async function loadPublishingMask({
  spaceId,
  source,
  revisionId,
  target,
  mode,
}: {
  spaceId: string;
  source: PublishingMaskSource;
  revisionId: string;
  target: BrowserCompanionTarget;
  mode: 'article' | 'images';
}): Promise<PublishingMaskOverrides | undefined> {
  if (target === 'chatgpt') return undefined;
  const draft = await window.desktopApi.publishingMasks.get({
    expectedSpaceId: spaceId,
    source,
    target: publishingMaskTarget(target, mode),
    expectedSourceRevisionId: revisionId,
  });
  return draft ? publishingMaskOverridesForTarget(publishingMaskTarget(target, mode), draft.overrides) : undefined;
}

export function applyPublishingMaskFields(
  source: { title: string; coverAssetId: string | null },
  availableMediaIds: readonly string[],
  overrides: PublishingMaskOverrides | undefined,
) {
  const fields = publishingMaskFields(source, overrides);
  if (fields.coverAssetId && !availableMediaIds.includes(fields.coverAssetId))
    throw new Error('PUBLISHING_MASK_MEDIA_CHANGED');
  return fields;
}
