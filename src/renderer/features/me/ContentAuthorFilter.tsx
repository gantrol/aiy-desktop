import type { ArticleListItem } from '@/shared/contracts';
import { CreationLibraryAuthorSelect } from '@/renderer/components/creator/CreationLibraryAuthorSelect';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ContentAuthorFilter({
  articles,
  value = 'ALL',
  onChange,
}: {
  articles: ArticleListItem[];
  value?: string;
  onChange(value: string): void;
}) {
  const { messages } = useI18n();
  const authors = new Map(articles.flatMap((article) => article.authors.map((author) => [author.id, author] as const)));
  const options = [...authors.values()]
    .map((author) => ({ value: author.id, label: authorDisplayName(author, messages) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return <CreationLibraryAuthorSelect inline value={value} options={options} onChange={onChange} />;
}
