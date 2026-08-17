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

interface TermExpressionSelectionCandidate {
  contextKey: string;
  locale: ContentLocale;
}

/**
 * Selects an expression without inventing a context choice. Implicit callers
 * prefer the canonical default and may use a non-default context only when it
 * is the sole context available. Multiple non-default contexts remain
 * ambiguous until the caller supplies an explicit context key.
 */
export function selectTermExpressionCandidate<T extends TermExpressionSelectionCandidate>(
  candidates: readonly T[],
  locale: ContentLocale,
  primaryLocale: ContentLocale,
  contextKey?: string,
): T | null {
  const scopedCandidates = (() => {
    if (contextKey !== undefined) return candidates.filter((item) => item.contextKey === contextKey);
    const defaultCandidates = candidates.filter((item) => item.contextKey === DEFAULT_TERM_CONTEXT_KEY);
    if (defaultCandidates.length) return defaultCandidates;
    return new Set(candidates.map((item) => item.contextKey)).size === 1 ? candidates : [];
  })();
  return (
    scopedCandidates.find((item) => localeMatches(item.locale, locale)) ??
    scopedCandidates.find((item) => localeMatches(item.locale, primaryLocale)) ??
    scopedCandidates.find((item) => localeMatches(item.locale, 'en')) ??
    scopedCandidates[0] ??
    null
  );
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
  contextKey?: string,
): TermModelExpressionDto | null {
  const candidates = term.modelExpressions.filter((item) => item.modelKey === modelKey);
  return selectTermExpressionCandidate(candidates, locale, term.titleLocale, contextKey);
}

export function termSearchableText(term: TermListItem) {
  const localizations: TermLocalizationDto[] = [primaryTermContent(term), ...term.localizations];
  return localizations
    .flatMap((item) => [item.title, item.definition, ...item.aliases])
    .concat(term.modelExpressions.flatMap((item) => [item.positive, item.negative]))
    .join(' ');
}
