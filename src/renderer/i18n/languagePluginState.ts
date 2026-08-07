import type { ExtensionDto, Locale } from '@/shared/contracts';
import { languagePluginOrder } from '@/renderer/i18n/catalog';

export const LANGUAGE_PLUGIN_STATE_EVENT = 'aiy:language-plugins-changed';

export function enabledLanguagePluginLocales(
  extensions: readonly ExtensionDto[],
  catalogExtensionIds: ReadonlySet<string>,
): Locale[] {
  return languagePluginOrder.filter((locale) => {
    const extension = extensions.find(
      (item) =>
        item.manifest.kind === 'LANGUAGE' &&
        item.manifest.language?.locale === locale &&
        catalogExtensionIds.has(item.manifest.id),
    );
    return (
      extension?.manifest.kind === 'LANGUAGE' &&
      extension.manifest.language?.locale === locale &&
      extension.enabled &&
      extension.compatible
    );
  });
}

export function publishLanguagePluginState(extensions: readonly ExtensionDto[]) {
  window.dispatchEvent(
    new CustomEvent<readonly ExtensionDto[]>(LANGUAGE_PLUGIN_STATE_EVENT, {
      detail: extensions,
    }),
  );
}
