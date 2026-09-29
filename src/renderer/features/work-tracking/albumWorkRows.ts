import type { BootstrapDto } from '@/shared/contracts';
import { matchesAuthor } from '@/shared/contracts/authorship';
import type { WorkItem, WorkSnapshot } from '@/shared/contracts/work-tracking';
import type { WorkSourceOption } from '@/renderer/features/work-tracking/WorkItemEditor';
import type { WorkFilters } from '@/renderer/features/work-tracking/WorkTrackingToolbar';

export interface AlbumWorkRow {
  id: string;
  title: string;
  item?: WorkItem;
  sources: WorkSourceOption[];
  defaultFormId: string;
}

export function albumWorkRows(
  data: BootstrapDto,
  albumId: string,
  snapshot: WorkSnapshot,
  filters: WorkFilters,
  missing: string,
  untitled: string,
  choices: Record<string, string> = {},
) {
  const articles = new Map(
    (data.articles ?? []).filter((article) => article.status === 'ACTIVE').map((article) => [article.id, article]),
  );
  const tracked = new Map(snapshot.items.map((item) => [item.id, item]));
  const query = filters.search.toLocaleLowerCase();
  return data.creationItems
    .filter((item) => item.albumId === albumId && item.lifecycle === 'ACTIVE')
    .map((creation): AlbumWorkRow => {
      const item = tracked.get(creation.id);
      const sources = creation.forms.flatMap((form) => {
        const article = form.entity.kind === 'ARTICLE' ? articles.get(form.entity.id) : undefined;
        return article
          ? [
              {
                itemId: creation.id,
                formId: form.id,
                articleId: article.id,
                title: article.content.title || untitled,
                authors: article.authors,
              },
            ]
          : [];
      });
      const preferred = sources.find(
        (source) => source.formId === (item?.descriptionFormId ?? choices[creation.id] ?? creation.primaryFormId),
      );
      return {
        id: creation.id,
        item,
        sources,
        title: (item ? preferred?.title : (preferred?.title ?? sources[0]?.title)) ?? missing,
        defaultFormId: preferred?.formId ?? (sources.length === 1 ? sources[0]!.formId : ''),
      };
    })
    .filter(
      (row) =>
        (!row.item || filters.showStopped || row.item.enabled) &&
        (filters.kind === 'ALL' || (filters.kind === 'UNTRACKED' ? !row.item : row.item?.kind === filters.kind)) &&
        (filters.status === 'ALL' || row.item?.state === filters.status) &&
        matchesAuthor(
          row.sources.find((source) => source.formId === row.defaultFormId)?.authors ?? [],
          filters.author,
        ) &&
        `${row.title} ${row.item?.owner ?? ''}`.toLocaleLowerCase().includes(query),
    );
}
