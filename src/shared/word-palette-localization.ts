import type {
  ContentLocale,
  WordPaletteLocalizationDto,
  WordPaletteOptionLocalizationDto,
  WordPaletteParameterLocalizationDto,
} from '@/shared/contracts';

function canonicalLocale(locale: ContentLocale) {
  const normalized = locale.trim();
  if (!normalized) return '';
  try {
    return Intl.getCanonicalLocales(normalized)[0]?.toLocaleLowerCase() ?? normalized.toLocaleLowerCase();
  } catch {
    return normalized.toLocaleLowerCase();
  }
}

export function paletteLocaleMatches(candidate: ContentLocale, requested: ContentLocale) {
  const left = canonicalLocale(candidate);
  const right = canonicalLocale(requested);
  return left === right || left.split('-')[0] === right.split('-')[0];
}

export function paletteLocaleEquals(candidate: ContentLocale, requested: ContentLocale) {
  return canonicalLocale(candidate) === canonicalLocale(requested);
}

function matchingLocalization<T extends { locale: ContentLocale }>(items: readonly T[], locale: ContentLocale) {
  return items.find((item) => paletteLocaleMatches(item.locale, locale));
}

export function resolveWordPaletteContent(
  palette: {
    name: string;
    nameLocale: ContentLocale;
    description: string;
    localizations: readonly WordPaletteLocalizationDto[];
  },
  locale: ContentLocale,
) {
  if (paletteLocaleMatches(palette.nameLocale, locale)) {
    return { locale: palette.nameLocale, name: palette.name, description: palette.description };
  }
  return (
    matchingLocalization(palette.localizations, locale) ?? {
      locale: palette.nameLocale,
      name: palette.name,
      description: palette.description,
    }
  );
}

export function resolveLocalizedName(
  value: { name: string; nameLocale: ContentLocale; localizations: readonly { locale: ContentLocale; name: string }[] },
  locale: ContentLocale,
) {
  if (paletteLocaleMatches(value.nameLocale, locale)) return value.name;
  return matchingLocalization(value.localizations, locale)?.name ?? value.name;
}

export function resolveWordPaletteParameterName(
  parameter: {
    name: string;
    nameLocale: ContentLocale;
    localizations: readonly WordPaletteParameterLocalizationDto[];
  },
  locale: ContentLocale,
) {
  if (paletteLocaleMatches(parameter.nameLocale, locale)) return parameter.name;
  return matchingLocalization(parameter.localizations, locale)?.name ?? parameter.name;
}

export function resolveWordPaletteOptionLabel(
  option: {
    label: string;
    labelLocale: ContentLocale;
    localizations: readonly WordPaletteOptionLocalizationDto[];
  },
  locale: ContentLocale,
) {
  if (paletteLocaleMatches(option.labelLocale, locale)) return option.label;
  return matchingLocalization(option.localizations, locale)?.label ?? option.label;
}

export function replacePaletteLocalization<T extends { locale: ContentLocale }>(
  items: readonly T[],
  locale: ContentLocale,
  replacement: T,
) {
  return [...items.filter((item) => !paletteLocaleEquals(item.locale, locale)), replacement];
}
