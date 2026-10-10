import { assertPublicContentLinks } from '@/shared/content-public-links';
import { discardTablePreviews } from '@/renderer/features/browser-companion/prepareTableImagePost';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import type { ArticleDto, BrowserCompanionStageInput, BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import type { ArticleDeliveryUploadInput } from '@/shared/contracts/article-delivery';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import type { MessageCatalog } from '@/renderer/i18n/types';
import {
  prepareArticleHandoff,
  prepareWechatArticleHandoff,
} from '@/renderer/features/browser-companion/prepareArticleHandoff';
import {
  articleDeliveryRequestErrorMessage,
  articleDeliveryTargetUnavailableMessage,
} from '@/renderer/features/article-delivery/presentation';
import {
  articleUploadTargetKey,
  type ArticleDeliveryPreferences,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import type { ArticleDeliveryTarget } from '@/renderer/features/article-delivery/articleDeliveryTargets';
import type { ArticleDeliveryProfileDraft } from '@/renderer/features/article-delivery/useArticleDeliverySetup';
import {
  isPublishingMaskError,
  publishingMaskErrorMessage,
} from '@/renderer/features/browser-companion/publishingMask';

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
  signal,
}: {
  article: ArticleDto;
  spaceId: string;
  preferences: ArticleDeliveryPreferences;
  definitions: ReadonlyMap<string, ArticleDeliveryTarget>;
  profiles: Readonly<Record<string, ArticleDeliveryProfileSelection>>;
  watermark: BrowserCompanionWatermarkSelection;
  messages: MessageCatalog;
  signal?: AbortSignal;
}) {
  const apiInputs: PreparedArticleApiDelivery[] = [];
  const browserInputs: { key: string; input: BrowserCompanionStageInput }[] = [];
  const failures: Record<string, string> = {};
  let expanded: Awaited<ReturnType<typeof window.desktopApi.contentLibrary.freeze>> | null = null;
  let expansionError: string | null = null;
  if (preferences.targets.length) {
    try {
      // The entire mixed API/browser batch shares one durable source-resolution snapshot.
      expanded = await window.desktopApi.contentLibrary.freeze(article.content.markdown, spaceId);
      assertPublicContentLinks(expanded.markdown);
    } catch (reason) {
      expanded = null;
      expansionError =
        reason && typeof reason === 'object' && 'code' in reason && reason.code === 'CONTENT_LIBRARY_SPACE_CHANGED'
          ? messages.articleDelivery.errors.DELIVERY_SPACE_CHANGED
          : referenceFailure(
              reason,
              messages.referenceOutline,
              articleDeliveryRequestErrorMessage(reason, messages.articleDelivery),
            );
    }
  }
  for (const target of preferences.targets) {
    if (signal?.aborted) {
      discardTablePreviews(
        spaceId,
        browserInputs.map((plan) => plan.input),
      );
      signal.throwIfAborted();
    }
    const key = articleUploadTargetKey(target);
    try {
      if (!expanded) {
        failures[key] = expansionError ?? messages.publishing.failed;
        continue;
      }
      if (target.kind === 'API') {
        const definition = definitions.get(key);
        const profile = profiles[key];
        if (!definition) {
          failures[key] = messages.articleDelivery.batch.missingExtension;
          continue;
        }
        if (!definition.activated) {
          failures[key] = articleDeliveryTargetUnavailableMessage(definition, messages);
          continue;
        }
        if (!profile?.slug) {
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
            referenceResolutionId: expanded.resolutionId,
            expectedDeliveryMode: definition.deliveryMode,
            expectedProfile: { slug: profile.slug, description: profile.description },
            watermark,
            imagePreparation: { version: 1, mode: target.imageMode },
          },
        });
        continue;
      }
      let preparationError = messages.publishing.failed;
      const notify = (message: string) => {
        preparationError = message;
      };
      const prepared =
        target.target === 'wechat' && target.mode === 'article'
          ? await prepareWechatArticleHandoff({
              article,
              spaceId,
              expandedContent: expanded,
              referenceResolutionId: expanded.resolutionId,
              referenceTitle: messages.articleWechat.referenceTitle,
              copy: { ...messages.desktopPetals.document, ...messages.browserCompanion.wechatArticle },
              notify,
            })
          : await prepareArticleHandoff({
              article,
              spaceId,
              expandedContent: expanded,
              target: target.target,
              watermark,
              tableLabel: messages.publishing.tables.table,
              signal,
              copy: messages.desktopPetals.document,
              notify,
            });
      if (!prepared) {
        failures[key] = preparationError;
        continue;
      }
      browserInputs.push({ key, input: { ...prepared, target: target.target, watermark } });
    } catch (reason) {
      if (isPublishingMaskError(reason)) {
        failures[key] = publishingMaskErrorMessage(reason, messages);
        continue;
      }
      const code = browserCompanionStageErrorCodeSchema.safeParse(reason instanceof Error ? reason.message : reason);
      failures[key] = code.success
        ? messages.browserCompanion.stageErrors[code.data]
        : articleDeliveryRequestErrorMessage(reason, messages.articleDelivery);
    }
  }
  return { apiInputs, browserInputs, failures };
}
