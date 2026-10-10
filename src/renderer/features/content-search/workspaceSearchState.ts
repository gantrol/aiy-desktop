import type { SearchListState } from '@/renderer/features/content-search/ContentSearchResults';
import type { WorkspaceSearchItem } from '@/renderer/features/content-search/workspaceSearchItems';
import type { useImageSearch } from '@/renderer/features/content-search/useImageSearch';
import type { WorkspaceSearchMode } from '@/shared/contracts/image-search';

type Channel = SearchListState<WorkspaceSearchItem>;

export function separateImageStatus(
  search: Channel,
  images: ReturnType<typeof useImageSearch>['result'],
  documents?: Channel,
  mode: WorkspaceSearchMode = 'SEMANTIC',
) {
  if (!search.result || !images?.channels) return;
  const documentCoverage = documents?.result?.coverage;
  const imageTextPending = mode === 'TEXT' && images.coverage.pending > 0;
  const contentPending = Boolean(documentCoverage?.pending);
  const pendingCoverage =
    imageTextPending && !contentPending
      ? images.coverage
      : contentPending && !imageTextPending && documentCoverage
        ? documentCoverage
        : search.result.coverage;
  search.statusCoverage = {
    ...pendingCoverage,
    unavailable: documentCoverage?.unavailable ?? 0,
    limited: documentCoverage?.limited ?? 0,
  };
  if (imageTextPending) search.statusKind = contentPending ? 'CONTENT_AND_IMAGE_TEXT' : 'IMAGE_TEXT';
}

export function imageSearchChannel(images: ReturnType<typeof useImageSearch>): Channel {
  const result = images.result;
  return {
    ...images,
    result: result
      ? {
          ...result,
          warning: undefined,
          scope: 'CURRENT_SAVED_DOCUMENTS',
          coverage: { ...result.coverage, limited: result.coverage.limited ?? 0 },
        }
      : null,
    error: images.error || result?.indexError || '',
    loadingMore: images.busy && result?.nextOffset != null,
    hasMore: result?.nextOffset != null,
    pause: () => images.setPaused(!images.paused),
    more: () => {
      void images.more();
    },
  };
}

/** Keep independent rankings, coverage and failures; no cross-modal score arithmetic. */
export function combineSearchChannels(context: string, channels: Channel[]): Channel {
  const coverage = { total: 0, ready: 0, pending: 0, unavailable: 0, limited: 0 };
  const batches = channels.map((channel) => channel.result?.items ?? []);
  for (const channel of channels) {
    if (!channel.result) {
      if (!channel.error) coverage.pending++;
      continue;
    }
    for (const key of ['total', 'ready', 'pending', 'unavailable', 'limited'] as const)
      coverage[key] += channel.result.coverage[key];
  }
  const items: WorkspaceSearchItem[] = [];
  const length = Math.max(0, ...batches.map((batch) => batch.length));
  for (let index = 0; index < length; index++) for (const batch of batches) if (batch[index]) items.push(batch[index]);
  const indexing = channels.filter((channel) => !channel.result || channel.result.coverage.pending > 0);
  const paused = indexing.length > 0 && indexing.every((channel) => channel.paused);
  return {
    key: JSON.stringify([context, ...channels.map((channel) => channel.key)]),
    result:
      channels.length && !channels.some((channel) => channel.result)
        ? null
        : {
            scope: 'CURRENT_SAVED_DOCUMENTS',
            snapshot: JSON.stringify(channels.map((channel) => channel.result?.snapshot)),
            reset: channels.some((channel) => channel.result?.reset),
            coverage,
            items,
            nextOffset: null,
          },
    busy: channels.some((channel) => channel.busy),
    error: channels.find((channel) => channel.error)?.error ?? '',
    loadingMore: channels.some((channel) => channel.loadingMore),
    hasMore: channels.some((channel) => channel.hasMore),
    paused,
    pause: () => {
      for (const channel of channels) if (channel.paused === paused) channel.pause();
    },
    refresh: () => {
      for (const channel of channels) channel.refresh();
    },
    more: () => {
      for (const channel of channels) channel.more();
    },
  };
}

export function canSuggestSemanticSearch(search: Channel, query: string, mode: string) {
  const result = search.result;
  if (mode !== 'TEXT' || !query.trim() || search.busy || search.error || !result || result.items.length) return false;
  return !result.coverage.pending && !result.coverage.unavailable && !result.coverage.limited;
}
