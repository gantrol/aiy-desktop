import type { Locale, WordPaletteDto, WordPaletteRevisionDto } from '@/shared/contracts';
import { resolveTermExpression } from '@/shared/term-localization';

const normalizeSearchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export function filterWordPalettes(palettes: WordPaletteDto[], query: string): WordPaletteDto[] {
  const tokens = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return palettes;
  return palettes.filter((palette) => {
    const searchable = normalizeSearchText(
      [
        palette.name,
        palette.description,
        ...palette.localizations.flatMap((item) => [item.name, item.description]),
        ...palette.terms.flatMap((term) => [
          term.title,
          ...term.localizations.map((item) => item.title),
          term.stableKey,
          term.definition,
          ...term.modelExpressions.flatMap((expression) => [expression.positive, expression.negative]),
          ...term.aliases,
        ]),
        ...palette.parameters.flatMap((parameter) => [
          parameter.name,
          ...parameter.localizations.map((item) => item.name),
          parameter.stableKey,
          ...parameter.options.flatMap((option) => [
            option.label,
            ...option.localizations.map((item) => item.label),
            option.value,
            ...option.contents.flatMap((content) =>
              content.kind === 'TERM'
                ? [
                    content.term.title,
                    ...content.term.localizations.map((item) => item.title),
                    ...content.term.modelExpressions.flatMap((expression) => [
                      expression.positive,
                      expression.negative,
                    ]),
                  ]
                : [content.promptFragment, content.negativeFragment],
            ),
          ]),
        ]),
        ...palette.promptNodes.flatMap((node) =>
          node.kind === 'TEXT' ? [node.promptFragment, node.negativeFragment] : [],
        ),
      ].join('\n'),
    );
    return tokens.every((token) => searchable.includes(token));
  });
}

export function defaultWordPaletteParameterValues(
  palette: Pick<WordPaletteDto | WordPaletteRevisionDto, 'parameters'>,
): Record<string, string> {
  return Object.fromEntries(
    palette.parameters.map((parameter) => [
      parameter.stableKey,
      parameter.required ? (parameter.options[0]?.value ?? '') : '',
    ]),
  );
}

export function renderPaletteParameters(
  palette: Pick<WordPaletteDto | WordPaletteRevisionDto, 'parameters'>,
  values: Record<string, string>,
  promptLocale: Locale = 'en',
): string[] {
  return palette.parameters.flatMap((parameter) => {
    const selected = parameter.options.find((option) => option.value === values[parameter.stableKey]);
    if (!selected) return [];
    const expression = selected.contents
      .map((content) =>
        content.kind === 'TERM'
          ? (resolveTermExpression(content.term, 'gpt-image-2', promptLocale)?.positive ?? content.term.title)
          : content.promptFragment,
      )
      .join('');
    return expression.trim() ? [expression] : [];
  });
}

export function renderPaletteParameterNegatives(
  palette: Pick<WordPaletteDto | WordPaletteRevisionDto, 'parameters'>,
  values: Record<string, string>,
  promptLocale: Locale = 'en',
): string[] {
  return palette.parameters.flatMap((parameter) => {
    const selected = parameter.options.find((option) => option.value === values[parameter.stableKey]);
    if (!selected) return [];
    const expression = selected.contents
      .map((content) =>
        content.kind === 'TERM'
          ? (resolveTermExpression(content.term, 'gpt-image-2', promptLocale)?.negative ?? '')
          : content.negativeFragment,
      )
      .join('');
    return expression.trim() ? [expression] : [];
  });
}
