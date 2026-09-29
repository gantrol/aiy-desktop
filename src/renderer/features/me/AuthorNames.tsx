import type { AuthorSummary } from '@/shared/contracts/authorship';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { useI18n } from '@/renderer/i18n/useI18n';

export function authorDisplayName(author: AuthorSummary, messages: MessageCatalog) {
  if (author.name) return author.name;
  if (author.application)
    return (
      messages.contentProvenance.applications[
        author.application as keyof MessageCatalog['contentProvenance']['applications']
      ] ?? author.application
    );
  return messages.me.authors.me;
}

export function AuthorNames({ authors = [] }: { authors?: readonly AuthorSummary[] }) {
  const { messages } = useI18n();
  return authors.length ? (
    <span>{authors.map((author) => authorDisplayName(author, messages)).join(' · ')}</span>
  ) : null;
}
