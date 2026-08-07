import {
  DEFAULT_TERM_CONTEXT_KEY,
  type ContentLocale,
  type TermListItem,
  type TermLocalizationDto,
  type TermModelExpressionDto,
} from '@/shared/contracts';

export interface ResolvedTermContent {
  locale: ContentLocale;
  title: string;
  definition: string;
  aliases: string[];
}

const normalizedLocale = (locale: ContentLocale) => locale.trim().toLowerCase();

function localeMatches(candidate: ContentLocale, requested: ContentLocale) {
  const left = normalizedLocale(candidate);
  const right = normalizedLocale(requested);
  return left === right || left.split('-')[0] === right.split('-')[0];
}

export function primaryTermContent(term: TermListItem): ResolvedTermContent {
  return {
    locale: term.titleLocale,
    title: term.title,
    definition: term.definition,
    aliases: term.aliases,
  };
}

export function resolveTermContent(term: TermListItem, locale: ContentLocale): ResolvedTermContent {
  if (localeMatches(term.titleLocale, locale)) return primaryTermContent(term);
  const localization = term.localizations.find((item) => localeMatches(item.locale, locale));
  return localization ?? primaryTermContent(term);
}

export function resolveTermTitle(term: TermListItem, locale: ContentLocale) {
  return resolveTermContent(term, locale).title;
}

export function resolveAlternateTermTitle(term: TermListItem, locale: ContentLocale) {
  const resolved = resolveTermContent(term, locale);
  if (resolved.locale !== term.titleLocale) return term.title;
  return term.localizations.find((item) => item.title !== resolved.title)?.title ?? '';
}

export function primaryTermClassification(term: TermListItem) {
  return (
    term.classifications.find((classification) => classification.id === term.primaryDirectoryClassificationId) ??
    term.classifications[0] ??
    null
  );
}

export function termFacetValueIds(term: TermListItem) {
  return [
    ...new Set(
      term.classifications.flatMap((classification) => [
        classification.primaryValueId,
        classification.secondaryValueId,
      ]),
    ),
  ].filter((id): id is string => Boolean(id));
}

export function resolveTermExpression(
  term: TermListItem,
  modelKey: string,
  locale: ContentLocale,
  contextKey = DEFAULT_TERM_CONTEXT_KEY,
): TermModelExpressionDto | null {
  const candidates = term.modelExpressions.filter(
    (item) => item.modelKey === modelKey && item.contextKey === contextKey,
  );
  return (
    candidates.find((item) => localeMatches(item.locale, locale)) ??
    candidates.find((item) => localeMatches(item.locale, term.titleLocale)) ??
    candidates.find((item) => localeMatches(item.locale, 'en')) ??
    candidates[0] ??
    null
  );
}

export function termSearchableText(term: TermListItem) {
  const localizations: TermLocalizationDto[] = [primaryTermContent(term), ...term.localizations];
  return localizations
    .flatMap((item) => [item.title, item.definition, ...item.aliases])
    .concat(term.modelExpressions.flatMap((item) => [item.positive, item.negative]))
    .join(' ');
}
