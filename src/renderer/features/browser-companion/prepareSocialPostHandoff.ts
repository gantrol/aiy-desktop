import { prepareImagePostHandoff } from '@/renderer/features/browser-companion/prepareImagePostHandoff';
import type { BrowserCompanionStageInput, BrowserCompanionTarget, SocialPostContentInput } from '@/shared/contracts';
import { socialPostContentSchema } from '@/shared/contracts/social-post';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

type PreparedHandoff = Omit<BrowserCompanionStageInput, 'target'>;

export async function prepareSocialPostHandoff({
  content,
  dirty,
  notify,
  persist,
  postId,
  target,
  copy,
}: {
  content: SocialPostContentInput;
  dirty: boolean;
  notify(message: string): void;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  postId: string;
  target: BrowserCompanionTarget;
  copy: DesktopPetalMessages['document'];
}): Promise<PreparedHandoff | null> {
  const snapshot = socialPostContentSchema.parse(content);
  if (dirty && !(await persist(snapshot))) return null;
  const expanded =
    snapshot.format === 'markdown'
      ? await window.desktopApi.contentLibrary.render(snapshot.body)
      : { markdown: snapshot.body, media: [] };
  return prepareImagePostHandoff({
    source: { kind: 'social-post', id: postId },
    title: snapshot.title,
    body: expanded.markdown,
    format: snapshot.format === 'markdown' ? 'markdown' : 'plain',
    mediaAssetIds: [
      ...(target === 'xiaohongshu' && snapshot.coverAssetId ? [snapshot.coverAssetId] : []),
      ...snapshot.mediaAssetIds,
      ...expanded.media.map((media) => media.assetId),
    ],
    mediaBindings: expanded.media,
    target,
    copy,
    notify,
  });
}
