import type { ArticleDto, BrowserCompanionStageInput, BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import type { ArticleDeliveryUploadInput } from '@/shared/contracts/article-delivery';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import type { MessageCatalog } from '@/renderer/i18n/types';
import {
  prepareArticleHandoff,
  prepareWechatArticleHandoff,
} from '@/renderer/features/browser-companion/prepareArticleHandoff';
import { articleDeliveryRequestErrorMessage } from '@/renderer/features/article-delivery/presentation';
import {
  articleUploadTargetKey,
  type ArticleDeliveryPreferences,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import type { ArticleDeliveryTarget } from '@/renderer/features/article-delivery/articleDeliveryTargets';
import type { ArticleDeliveryProfileDraft } from '@/renderer/features/article-delivery/useArticleDeliverySetup';

export interface PreparedArticleApiDelivery {
  key: string;
  input: ArticleDeliveryUploadInput;
  profile: ArticleDeliveryProfileDraft;
  saveProfile: boolean;
}

export interface ArticleDeliveryProfileSelection extends ArticleDeliveryProfileDraft {
  saveRequired: boolean;
}

export async function prepareArticleDeliveryBatch({
  article,
  spaceId,
  preferences,
  definitions,
  profiles,
  watermark,
  messages,
}: {
  article: ArticleDto;
  spaceId: string;
  preferences: ArticleDeliveryPreferences;
  definitions: ReadonlyMap<string, ArticleDeliveryTarget>;
  profiles: Readonly<Record<string, ArticleDeliveryProfileSelection>>;
  watermark: BrowserCompanionWatermarkSelection;
  messages: MessageCatalog;
}) {
  const apiInputs: PreparedArticleApiDelivery[] = [];
  const browserInputs: { key: string; input: BrowserCompanionStageInput }[] = [];
  const failures: Record<string, string> = {};
  let expanded: Awaited<ReturnType<typeof window.desktopApi.contentLibrary.render>> | null = null;
  let expansionError: string | null = null;
  if (preferences.targets.some((target) => target.kind === 'BROWSER')) {
    try {
      // Expand the same saved content once for every selected browser destination.
      expanded = await window.desktopApi.contentLibrary.render(article.content.markdown, spaceId);
    } catch (reason) {
      expansionError =
        reason && typeof reason === 'object' && 'code' in reason && reason.code === 'CONTENT_LIBRARY_SPACE_CHANGED'
          ? messages.articleDelivery.errors.DELIVERY_SPACE_CHANGED
          : articleDeliveryRequestErrorMessage(reason, messages.articleDelivery);
    }
  }
  for (const target of preferences.targets) {
    const key = articleUploadTargetKey(target);
    try {
      if (target.kind === 'API') {
        const definition = definitions.get(key);
        const profile = profiles[key];
        if (!definition?.activated || !profile?.slug) {
          failures[key] = messages.articleDelivery.batch.unavailable;
          continue;
        }
        apiInputs.push({
          key,
          profile: { slug: profile.slug, description: profile.description },
          saveProfile: profile.saveRequired,
          input: {
            extensionId: target.extensionId,
            channelId: target.channelId,
            spaceId,
            articleId: article.id,
            expectedRevisionId: article.revisionId,
            expectedDeliveryMode: definition.deliveryMode,
            expectedProfile: { slug: profile.slug, description: profile.description },
            watermark,
            imagePreparation: { version: 1, mode: target.imageMode },
          },
        });
        continue;
      }
      if (!expanded) {
        failures[key] = expansionError ?? messages.publishing.failed;
        continue;
      }
      let preparationError = messages.publishing.failed;
      const notify = (message: string) => {
        preparationError = message;
      };
      const prepared =
        target.target === 'wechat' && preferences.wechatMode === 'article'
          ? await prepareWechatArticleHandoff({
              article,
              expandedContent: expanded,
              referenceTitle: messages.articleWechat.referenceTitle,
              copy: { ...messages.desktopPetals.document, ...messages.browserCompanion.wechatArticle },
              notify,
            })
          : await prepareArticleHandoff({
              article,
              expandedContent: expanded,
              target: target.target,
              copy: messages.desktopPetals.document,
              notify,
            });
      if (!prepared) {
        failures[key] = preparationError;
        continue;
      }
      browserInputs.push({ key, input: { ...prepared, target: target.target, watermark } });
    } catch (reason) {
      const code = browserCompanionStageErrorCodeSchema.safeParse(reason instanceof Error ? reason.message : reason);
      failures[key] = code.success
        ? messages.browserCompanion.stageErrors[code.data]
        : articleDeliveryRequestErrorMessage(reason, messages.articleDelivery);
    }
  }
  return { apiInputs, browserInputs, failures };
}
