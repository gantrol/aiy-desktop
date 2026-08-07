import type {
  CreateWordPaletteInput,
  Locale,
  TermListItem,
  WordPaletteContentDto,
  WordPaletteContentInput,
  WordPaletteDto,
  WordPaletteOptionLocalizationDto,
  WordPaletteParameterDto,
  WordPaletteParameterLocalizationDto,
  WordPaletteParameterOptionDto,
} from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import {
  paletteLocaleMatches,
  replacePaletteLocalization,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';

const primaryPositiveExpression = (term: TermListItem) => term.modelExpressions[0]?.positive ?? term.title;

export interface PaletteParameterOptionDraft {
  editorKey: string;
  value: string;
  label: string;
  labelLocale: string;
  localizations: WordPaletteOptionLocalizationDto[];
  promptFragment: string;
  negativeFragment: string;
  termIds: string[];
  source?: WordPaletteParameterOptionDto;
}

export interface PaletteParameterDraft {
  editorKey: string;
  stableKey: string;
  name: string;
  nameLocale: string;
  localizations: WordPaletteParameterLocalizationDto[];
  required: boolean;
  options: PaletteParameterOptionDraft[];
  source?: WordPaletteParameterDto;
}

export function paletteParameterDrafts(
  palette: Pick<WordPaletteDto, 'parameters'>,
  locale: Locale,
): PaletteParameterDraft[] {
  return palette.parameters.map((parameter) => ({
    editorKey: parameter.id,
    stableKey: parameter.stableKey,
    name: resolveWordPaletteParameterName(parameter, locale),
    nameLocale: parameter.nameLocale,
    localizations: parameter.localizations,
    required: parameter.required,
    source: parameter,
    options: parameter.options.map((option) => ({
      editorKey: option.id,
      value: option.value,
      label: resolveWordPaletteOptionLabel(option, locale),
      labelLocale: option.labelLocale,
      localizations: option.localizations,
      promptFragment: option.contents
        .flatMap((content) => (content.kind === 'TEXT' ? [content.promptFragment] : []))
        .join(''),
      negativeFragment: option.contents
        .flatMap((content) => (content.kind === 'TEXT' ? [content.negativeFragment] : []))
        .join(''),
      termIds: option.contents.flatMap((content) => (content.kind === 'TERM' ? [content.term.id] : [])),
      source: option,
    })),
  }));
}

function sourceTextFragment(
  contents: readonly WordPaletteContentDto[],
  channel: 'promptFragment' | 'negativeFragment',
) {
  return contents.flatMap((content) => (content.kind === 'TEXT' ? [content[channel]] : [])).join('');
}

export function paletteOptionSourceStillMatches(option: PaletteParameterOptionDraft) {
  const contents = option.source?.contents;
  if (!contents) return false;
  const sourceTermIds = contents.flatMap((content) => (content.kind === 'TERM' ? [content.term.id] : []));
  return (
    sourceTextFragment(contents, 'promptFragment') === option.promptFragment &&
    sourceTextFragment(contents, 'negativeFragment') === option.negativeFragment &&
    sourceTermIds.length === option.termIds.length &&
    sourceTermIds.every((termId, index) => termId === option.termIds[index])
  );
}

export function renderPaletteOptionPrompt(
  option: PaletteParameterOptionDraft,
  termsById: ReadonlyMap<string, TermListItem>,
) {
  const contents = option.source?.contents;
  if (contents && paletteOptionSourceStillMatches(option)) {
    return contents
      .map((content) =>
        content.kind === 'TEXT'
          ? content.promptFragment
          : primaryPositiveExpression(termsById.get(content.term.id) ?? content.term),
      )
      .join('');
  }
  return `${option.termIds
    .map((termId) => {
      const term = termsById.get(termId);
      return term ? primaryPositiveExpression(term) : '';
    })
    .join('')}${option.promptFragment}`;
}

function contentInputs(contents: readonly WordPaletteContentDto[]): WordPaletteContentInput[] {
  return contents.map((content) =>
    content.kind === 'TERM'
      ? { kind: 'TERM' as const, termId: content.term.id }
      : {
          kind: 'TEXT' as const,
          promptFragment: content.promptFragment,
          negativeFragment: content.negativeFragment,
        },
  );
}

export function paletteParameterInputs(
  parameters: PaletteParameterDraft[],
  locale: Locale,
): CreateWordPaletteInput['parameters'] {
  return parameters.map((parameter) => {
    const primaryName = parameter.source?.name ?? parameter.name;
    const primaryLocale = parameter.source?.nameLocale ?? parameter.nameLocale;
    const sourceLocalizations = parameter.source?.localizations ?? parameter.localizations;
    const editingPrimary = paletteLocaleMatches(primaryLocale, locale);
    const localizations = editingPrimary
      ? sourceLocalizations.filter((item) => !paletteLocaleMatches(item.locale, primaryLocale))
      : replacePaletteLocalization(sourceLocalizations, locale, { locale, name: parameter.name.trim() });

    return {
      stableKey: parameter.stableKey,
      name: editingPrimary ? parameter.name.trim() : primaryName,
      nameLocale: primaryLocale,
      localizations,
      required: parameter.required,
      options: parameter.options.map((option) => {
        const primaryLabel = option.source?.label ?? option.label;
        const primaryLabelLocale = option.source?.labelLocale ?? option.labelLocale;
        const sourceOptionLocalizations = option.source?.localizations ?? option.localizations;
        const editingPrimaryLabel = paletteLocaleMatches(primaryLabelLocale, locale);
        const optionLocalizations = editingPrimaryLabel
          ? sourceOptionLocalizations.filter((item) => !paletteLocaleMatches(item.locale, primaryLabelLocale))
          : replacePaletteLocalization(sourceOptionLocalizations, locale, { locale, label: option.label.trim() });
        const sourceContents = option.source?.contents;
        const contents =
          sourceContents && paletteOptionSourceStillMatches(option)
            ? contentInputs(sourceContents)
            : [
                ...option.termIds.map((termId) => ({ kind: 'TERM' as const, termId })),
                ...(option.promptFragment.length || option.negativeFragment.length
                  ? [
                      {
                        kind: 'TEXT' as const,
                        promptFragment: option.promptFragment,
                        negativeFragment: option.negativeFragment,
                      },
                    ]
                  : []),
              ];
        return {
          value: option.value,
          label: editingPrimaryLabel ? option.label.trim() : primaryLabel,
          labelLocale: primaryLabelLocale,
          localizations: optionLocalizations,
          contents,
        };
      }),
    };
  });
}

export function paletteParametersAreValid(parameters: PaletteParameterDraft[]) {
  return parameters.every((parameter) =>
    Boolean(
      parameter.name.trim() &&
      /^[a-z][a-z0-9_]{1,63}$/.test(parameter.stableKey) &&
      parameter.options.length &&
      parameter.options.every((option) => option.label.trim()),
    ),
  );
}

function nextIndexedValue(existing: readonly string[], prefix: string) {
  let index = 1;
  while (existing.includes(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function trailingInteger(value: string) {
  let end = value.length;
  while (end > 0 && value[end - 1].trim().length === 0) end -= 1;
  let start = end;
  while (start > 0 && value.charCodeAt(start - 1) >= 48 && value.charCodeAt(start - 1) <= 57) start -= 1;
  if (start === end) return 0;
  const parsed = Number(value.slice(start, end));
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function alternateTermLabels(term: TermListItem, locale: Locale): WordPaletteOptionLocalizationDto[] {
  const labels = [
    { locale: term.titleLocale, label: term.title },
    ...term.localizations.map((item) => ({
      locale: item.locale,
      label: item.title,
    })),
  ];
  const seen = new Set<string>();
  return labels.filter((item) => {
    const key = item.locale.trim().toLocaleLowerCase();
    if (!item.label.trim() || paletteLocaleMatches(item.locale, locale) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createTermOption(
  options: readonly PaletteParameterOptionDraft[],
  term: TermListItem,
  locale: Locale,
): PaletteParameterOptionDraft {
  const value = nextIndexedValue(
    options.map((option) => option.value),
    'option',
  );
  return {
    editorKey: `draft_${value}_${Date.now()}`,
    value,
    label: resolveTermTitle(term, locale),
    labelLocale: locale,
    localizations: alternateTermLabels(term, locale),
    promptFragment: '',
    negativeFragment: '',
    termIds: [term.id],
  };
}

export function createPromptOption(
  options: readonly PaletteParameterOptionDraft[],
  promptFragment: string,
  locale: Locale,
): PaletteParameterOptionDraft {
  const value = nextIndexedValue(
    options.map((option) => option.value),
    'option',
  );
  const promptText = promptFragment.trim();
  return {
    editorKey: `draft_${value}_${Date.now()}`,
    value,
    label: promptText.slice(0, 120),
    labelLocale: locale,
    localizations: [],
    promptFragment: promptText,
    negativeFragment: '',
    termIds: [],
  };
}

export function mergeChoiceOptions(
  options: readonly PaletteParameterOptionDraft[],
  incoming: readonly PaletteParameterOptionDraft[],
) {
  const merged = [...options];
  for (const option of incoming) {
    const value = nextIndexedValue(
      merged.map((item) => item.value),
      'option',
    );
    merged.push({ ...option, editorKey: `draft_${value}_${Date.now()}_${merged.length}`, value });
  }
  return merged;
}

export function createChoiceGroup(
  parameters: readonly PaletteParameterDraft[],
  locale: Locale,
  seeds: Array<{ kind: 'TERM'; term: TermListItem } | { kind: 'PROMPT'; text: string }>,
): PaletteParameterDraft {
  const groupNumber = Math.max(0, ...parameters.map((parameter) => trailingInteger(parameter.name))) + 1;
  const stableKey = `choice_${Date.now().toString(36)}_${groupNumber}`;
  const options: PaletteParameterOptionDraft[] = [];
  for (const seed of seeds) {
    options.push(
      seed.kind === 'TERM'
        ? createTermOption(options, seed.term, locale)
        : createPromptOption(options, seed.text, locale),
    );
  }
  return {
    editorKey: `draft_${stableKey}_${Date.now()}`,
    stableKey,
    name: locale === 'zh' ? `可选项 ${groupNumber}` : `Choice ${groupNumber}`,
    nameLocale: locale,
    localizations: [],
    required: true,
    options,
  };
}
