import type { ArticleDto } from '@/shared/contracts';
import { contentAuthorKey } from '@/shared/contracts/content-provenance';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { contentAuthorLabel } from '@/renderer/features/content-provenance/ContentProvenance';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ContentSourceFilter({
  articles,
  value = 'ALL',
  onChange,
}: {
  articles: ArticleDto[];
  value?: string;
  onChange(value: string): void;
}) {
  const l = useI18n().messages.contentProvenance;
  const options = new Map([['UNKNOWN', l.kinds.UNKNOWN]]);
  for (const article of articles)
    for (const author of article.provenance?.authors ?? [])
      options.set(
        contentAuthorKey(author),
        author.kind === 'AI' ? contentAuthorLabel(author, l) : l.kinds[author.kind],
      );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-40" aria-label={l.title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{l.all}</SelectItem>
        {[...options].map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
