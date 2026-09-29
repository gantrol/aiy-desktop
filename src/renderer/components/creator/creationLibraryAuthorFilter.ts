import { matchesAuthor } from '@/shared/contracts/authorship';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import type {
  CreationFormProjection,
  CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';

export interface CreationLibraryAuthorOption {
  value: string;
  label: string;
}

export function creationMatchesAuthor(forms: readonly CreationFormProjection[], author = 'ALL') {
  return matchesAuthor(
    forms.flatMap((form) => form.form.authors),
    author,
  );
}

export function creationLibraryAuthorOptions(
  items: readonly CreationItemProjection[],
  messages: MessageCatalog,
): CreationLibraryAuthorOption[] {
  const options = new Map<string, CreationLibraryAuthorOption>();
  for (const { orderedForms } of items)
    for (const form of orderedForms)
      for (const author of form.form.authors)
        options.set(author.id, { value: author.id, label: authorDisplayName(author, messages) });
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function readCreationLibraryAuthorFilter(value: unknown) {
  if (typeof value !== 'string') return 'ALL';
  // Persisted single-credit IDs keep their identity; old category/source filters cannot name one author reliably.
  const id = value.startsWith('CREDIT:') ? value.slice(7) : value;
  return /^(ALL|UNASSIGNED|[0-9a-f-]{36})$/.test(id) ? id : 'ALL';
}
