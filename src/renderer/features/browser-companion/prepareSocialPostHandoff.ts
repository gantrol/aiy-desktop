import {
  prepareTableImagePost,
  discardTablePreviews,
} from '@/renderer/features/browser-companion/prepareTableImagePost';
import type { BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import { publicationContainsTables, assertPublicationTableReferences } from '@/shared/publication-tables';
import {
  prepareWechatContentHandoff,
  type WechatArticleHandoffCopy,
} from '@/renderer/features/browser-companion/prepareArticleHandoff';
import type { BrowserCompanionStageInput, BrowserCompanionTarget, SocialPostContentInput } from '@/shared/contracts';
import { canonicalSocialPostContentJson, socialPostContentSchema } from '@/shared/contracts/social-post';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import { plainTextMarkdown } from '@/shared/content-document';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { applyPublishingMaskFields, loadPublishingMask } from '@/renderer/features/browser-companion/publishingMask';

type PreparedHandoff = Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;

interface PrepareSocialPostOptions {
  spaceId: string;
  content: SocialPostContentInput;
  dirty: boolean;
  notify(message: string): void;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  readSavedContent?(): SocialPostContentInput;
  readSavedRevisionId(): string;
  postId: string;
  copy: DesktopPetalMessages['document'];
  wechatMode?: 'article' | 'images';
  wechatArticle?: { referenceTitle: string; copy: WechatArticleHandoffCopy };
  watermark?: BrowserCompanionWatermarkSelection;
  tableLabel?: string;
  signal?: AbortSignal;
}

export interface PreparedSocialPostTarget {
  target: BrowserCompanionTarget;
  prepared: PreparedHandoff | null;
  error: string | null;
  sourceKey?: string;
}

/** Freeze the saved source and expand linked blocks once for the entire batch. */
export async function prepareSocialPostHandoffs({
  spaceId,
  content,
  dirty,
  persist,
  readSavedContent,
  readSavedRevisionId,
  postId,
  targets,
  copy,
  wechatMode = 'images',
  wechatArticle,
  watermark,
  tableLabel,
  signal,
}: PrepareSocialPostOptions & {
  targets: readonly BrowserCompanionTarget[];
}): Promise<PreparedSocialPostTarget[] | null> {
  let snapshot = socialPostContentSchema.parse(content);
  // The editor settles pending input before saving and may save a newer value than
  // its argument. Read the acknowledged revision, including an unsettled IME edit.
  if ((readSavedContent || dirty) && !(await persist(snapshot))) return null;
  if (readSavedContent) snapshot = socialPostContentSchema.parse(readSavedContent());
  const revisionId = readSavedRevisionId();
  const sourceKey = canonicalSocialPostContentJson(snapshot);
  const expanded =
    snapshot.format === 'markdown'
      ? await window.desktopApi.contentLibrary.freeze(snapshot.body, spaceId)
      : { markdown: snapshot.body, media: [] };
  const source = { kind: 'social-post' as const, id: postId };
  const mediaAssetIds = [...new Set([...snapshot.mediaAssetIds, ...expanded.media.map((media) => media.assetId)])];
  const results: PreparedSocialPostTarget[] = [];
  try {
    for (const target of new Set(targets)) {
      signal?.throwIfAborted();
      let error: string | null = null;
      const notify = (message: string) => {
        error = message;
      };
      try {
        const overrides = await loadPublishingMask({
          spaceId,
          source: { kind: 'SOCIAL_POST', id: postId },
          revisionId,
          target,
          mode: wechatMode,
        });
        const fields = applyPublishingMaskFields(snapshot, mediaAssetIds, overrides);
        let prepared: PreparedHandoff | null;
        if (target === 'wechat' && wechatMode === 'article') {
          if (!wechatArticle) throw new Error('WECHAT_ARTICLE_COPY_REQUIRED');
          prepared = prepareWechatContentHandoff({
            source,
            title: fields.title,
            markdown: snapshot.format === 'markdown' ? expanded.markdown : plainTextMarkdown(snapshot.body),
            mediaAssetIds,
            mediaBindings: expanded.media,
            coverAssetId: fields.coverAssetId,
            referenceTitle: wechatArticle.referenceTitle,
            copy: wechatArticle.copy,
            notify,
          });
        } else {
          if (snapshot.format === 'markdown') assertPublicationTableReferences(snapshot.body, expanded.markdown);
          prepared = await prepareTableImagePost(
            {
              source,
              title: fields.title,
              body: expanded.markdown,
              format: snapshot.format === 'markdown' ? 'markdown' : 'plain',
              leadingMediaAssetIds: target === 'xiaohongshu' && fields.coverAssetId ? [fields.coverAssetId] : [],
              mediaAssetIds:
                snapshot.format === 'markdown' && publicationContainsTables(expanded.markdown)
                  ? snapshot.mediaAssetIds
                  : mediaAssetIds,
              mediaBindings: expanded.media,
              target,
              copy,
              notify,
              preferredMediaAssetIds: overrides?.mediaOrder,
              titleInBody: overrides?.titleInBody,
            },
            spaceId,
            watermark,
            tableLabel,
            signal,
          );
        }
        results.push({ target, prepared, error: prepared ? null : (error ?? copy.failure), sourceKey });
      } catch (reason) {
        results.push({
          target,
          prepared: null,
          error: reason instanceof Error ? reason.message : String(reason),
          sourceKey,
        });
      }
    }
  } finally {
    if (signal?.aborted)
      discardTablePreviews(
        spaceId,
        results.flatMap((row) => (row.prepared ? [row.prepared] : [])),
      );
  }
  return results;
}

export async function prepareSocialPostHandoff(
  options: PrepareSocialPostOptions & { target: BrowserCompanionTarget },
): Promise<PreparedHandoff | null> {
  const result = await prepareSocialPostHandoffs({ ...options, targets: [options.target] });
  const item = result?.[0];
  if (item?.error) {
    if (browserCompanionStageErrorCodeSchema.safeParse(item.error).success) throw new Error(item.error);
    options.notify(item.error);
  }
  return item?.prepared ?? null;
}
