import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreationLibraryAuthorOption } from '@/renderer/components/creator/creationLibraryAuthorFilter';
import {
  isAllCreationLibraryFilter,
  isAllCreationLibraryTypes,
  type CreationLibraryFilter,
  type CreationLibraryTypeFilter,
} from '@/renderer/components/creator/creationLibraryFilter';

export interface CreationLibraryFilterOption {
  keys: (keyof CreationLibraryTypeFilter)[];
  label: string;
}

export function useCreationLibraryFilterLabels(
  filter: CreationLibraryFilter,
  authors: readonly CreationLibraryAuthorOption[] = [],
) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const kinds = messages.creator.album.formKinds;
  const options: CreationLibraryFilterOption[] = [
    { keys: ['animations'], label: kinds.ANIMATION },
    { keys: ['images'], label: labels.filterImages },
    { keys: ['documents'], label: labels.filterDocuments },
    { keys: ['articles', 'socialPosts'], label: messages.creator.manuscriptEditor.kind },
    { keys: ['outlines'], label: kinds.OUTLINE },
    { keys: ['inspirations'], label: kinds.INSPIRATION },
    { keys: ['evaluations'], label: kinds.EVALUATION_SUITE },
  ];
  const allSelected = isAllCreationLibraryTypes(filter);
  const selectedOptions = options.filter(({ keys }) => keys.some((key) => filter[key]));
  const noneSelected = selectedOptions.length === 0;
  const valueLabel = allSelected
    ? labels.filterAll
    : noneSelected
      ? labels.filterNone
      : selectedOptions.map(({ label }) => label).join(', ');
  const authorLabel =
    filter.author === 'UNASSIGNED'
      ? labels.filterAuthorUnconfirmed
      : authors.find((author) => author.value === filter.author)?.label;
  const controlLabel = `${labels.filter}: ${valueLabel}${filter.author && filter.author !== 'ALL' ? ` · ${labels.filterAuthor}: ${authorLabel ?? labels.filterAuthorUnavailable}` : ''}`;
  const active = !isAllCreationLibraryFilter(filter);
  return { options, allSelected, noneSelected, controlLabel, active };
}
