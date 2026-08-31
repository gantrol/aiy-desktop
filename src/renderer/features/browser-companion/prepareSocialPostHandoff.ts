import type { BrowserCompanionStageInput, BrowserCompanionTarget, SocialPostContentInput } from '@/shared/contracts';

type PreparedHandoff = Omit<BrowserCompanionStageInput, 'target'>;

const TARGET_LABELS: Record<BrowserCompanionTarget, { en: string; zh: string }> = {
  chatgpt: { en: 'ChatGPT', zh: 'ChatGPT' },
  wechat: { en: 'WeChat Official Account', zh: '微信公众号' },
  weibo: { en: 'Weibo', zh: '微博' },
};

export async function prepareSocialPostHandoff({
  content,
  dirty,
  notify,
  persist,
  postId,
  target,
  zh,
}: {
  content: SocialPostContentInput;
  dirty: boolean;
  notify(message: string): void;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  postId: string;
  target: BrowserCompanionTarget;
  zh: boolean;
}): Promise<PreparedHandoff | null> {
  const text = content.body.trim();
  if (!text) {
    notify(zh ? '请先填写正文' : 'Write the post body first');
    return null;
  }
  if (Array.from(text).length > 10_000) {
    notify(zh ? '上传正文不能超过 10000 字' : 'Upload is limited to 10,000 characters');
    return null;
  }
  const mediaLimit = target === 'wechat' ? 20 : 18;
  if (content.mediaAssetIds.length > mediaLimit) {
    const targetLabel = TARGET_LABELS[target][zh ? 'zh' : 'en'];
    notify(zh ? `${targetLabel}最多上传 ${mediaLimit} 张图` : `${targetLabel} accepts up to ${mediaLimit} images`);
    return null;
  }
  if (dirty && !(await persist(content))) return null;
  return {
    source: { kind: 'social-post', id: postId },
    contentKind: 'social-post-body',
    title: content.title.trim() || undefined,
    text,
    mediaAssetIds: content.mediaAssetIds,
  };
}
