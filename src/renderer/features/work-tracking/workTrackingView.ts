import type { BootstrapDto } from '@/shared/contracts';
import { matchesAuthor } from '@/shared/contracts/authorship';
import type { WorkSnapshot } from '@/shared/contracts/work-tracking';
import type { WorkFilters } from '@/renderer/features/work-tracking/WorkTrackingToolbar';

export function workTrackingView(
  data: BootstrapDto,
  snapshot: WorkSnapshot | null,
  filters: WorkFilters,
  missing: string,
  albumId?: string,
  untitled = missing,
) {
  const scope = new Set(
    data.creationItems.filter((item) => !albumId || item.albumId === albumId).map((item) => item.id),
  );
  const articles = new Map(
    (data.articles ?? []).filter((article) => article.status === 'ACTIVE').map((article) => [article.id, article]),
  );
  const sources = data.creationItems
    .filter((item) => item.lifecycle === 'ACTIVE')
    .flatMap((item) =>
      item.forms.flatMap((form) => {
        const article = form.entity.kind === 'ARTICLE' ? articles.get(form.entity.id) : null;
        return article
          ? [{ itemId: item.id, formId: form.id, articleId: article.id, title: article.content.title || untitled }]
          : [];
      }),
    );
  const forms = new Map(sources.map((source) => [source.formId, source]));
  const titles = new Map(
    (snapshot?.items ?? []).map((item) => [item.id, forms.get(item.descriptionFormId)?.title ?? missing]),
  );
  const articleRevisions = new Map((data.articles ?? []).map((article) => [article.id, article.revisionId]));
  const tracked = new Set(snapshot?.items.map((item) => item.id));
  const query = filters.search.toLocaleLowerCase();
  const items = (snapshot?.items ?? [])
    .filter(
      (item) =>
        (!albumId || scope.has(item.id)) &&
        (filters.showStopped || item.enabled) &&
        (filters.kind === 'ALL' || filters.kind === item.kind) &&
        (filters.status === 'ALL' || filters.status === item.state) &&
        matchesAuthor(articles.get(item.articleId)?.authors ?? [], filters.author) &&
        `${titles.get(item.id)} ${item.owner}`.toLocaleLowerCase().includes(query),
    )
    .slice()
    .reverse();
  const tasks = (snapshot?.tasks ?? [])
    .filter((task) => !albumId || task.inputs.some((input) => scope.has(input.itemId)))
    .filter((task) => `${task.objective} ${task.executor}`.toLocaleLowerCase().includes(query))
    .slice()
    .reverse();
  return {
    executions: (snapshot?.executions ?? [])
      .filter((entry) => !albumId || entry.itemIds.some((id) => scope.has(id)))
      .filter((entry) =>
        `${entry.title} ${entry.result} ${entry.executor.application}`.toLocaleLowerCase().includes(query),
      )
      .slice()
      .sort((a, b) => b.sourceUpdatedAt.localeCompare(a.sourceUpdatedAt)),
    sources: sources.filter((source) => scope.has(source.itemId) && !tracked.has(source.itemId)),
    titles,
    articleRevisions,
    items,
    taskItems: snapshot?.items.filter((item) => !albumId || scope.has(item.id)) ?? [],
    tasks,
  };
}
