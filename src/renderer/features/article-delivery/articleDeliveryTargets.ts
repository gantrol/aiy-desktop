import type { BrowserCompanionDestinationsResult, ExtensionDto, Locale } from '@/shared/contracts';
import { articleDeliveryMode, type ArticleDeliveryMode } from '@/shared/contracts/article-delivery';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import type { ArticleUploadTarget } from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

export function normalizeArticleDeliverySlug(value: string) {
  return trimSurroundingCharacters(
    value
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-'),
    '-',
  );
}

export interface ArticleDeliveryTarget {
  extensionId: string;
  channelId: string;
  displayName: string;
  pathPrefix: string;
  deliveryMode: ArticleDeliveryMode;
  activated: boolean;
}

export function articleDeliveryTargets(extensions: readonly ExtensionDto[], locale: Locale): ArticleDeliveryTarget[] {
  return extensions.flatMap((extension) => {
    const configuration = extension.manifest.configuration;
    if (configuration?.kind !== 'ARTICLE_DELIVERY') return [];
    const localized = localizeExtensionManifest(extension.manifest, locale);
    const channels = extension.manifest.contributes.deliveryChannels ?? [];
    // Connections load when the dialog opens, so bootstrap readiness cannot gate that read.
    const activated =
      extension.enabled &&
      extension.compatible &&
      extension.permissions.every((permission) => !permission.required || permission.granted);
    return channels.map((channelId) => ({
      extensionId: extension.manifest.id,
      channelId,
      displayName: channels.length > 1 ? `${localized.displayName} · ${channelId}` : localized.displayName,
      pathPrefix: configuration.pathPrefix,
      deliveryMode: articleDeliveryMode(configuration),
      activated,
    }));
  });
}

export function articleDeliveryTargetChoice(target: ArticleDeliveryTarget): ArticleUploadTarget {
  return { kind: 'API', extensionId: target.extensionId, channelId: target.channelId, imageMode: 'BALANCED' };
}

export function articleBrowserDestinationState(
  state: BrowserCompanionDestinationsResult | null,
  target: Extract<ArticleUploadTarget, { kind: 'BROWSER' }>['target'],
): 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'NO_COMPANION' {
  const route = state?.routes[target];
  if (!route) return 'NOT_CONFIGURED';
  const browser = state?.browsers.find((candidate) => candidate.id === route.browserId);
  const profile = browser?.profiles.find((candidate) => candidate.directory === route.profileDirectory);
  if (!browser?.available || !profile) return 'UNAVAILABLE';
  return profile.companionInstalled ? 'READY' : 'NO_COMPANION';
}
