import type { ExtensionLocalizationDto, ExtensionManifestDto, Locale } from '@/shared/contracts';

/** Resolve plugin-owned copy without making the renderer know extension ids. */
export function localizeExtensionManifest(manifest: ExtensionManifestDto, locale: Locale): ExtensionLocalizationDto {
  const localized = manifest.i18n?.locales[locale] ?? manifest.i18n?.locales[manifest.i18n.defaultLocale];
  return (
    localized ?? {
      displayName: manifest.displayName,
      description: manifest.description,
    }
  );
}
