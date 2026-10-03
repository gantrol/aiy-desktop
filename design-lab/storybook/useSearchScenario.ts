import { useState } from 'react';
import type { ContentSearchViewProps } from '@/renderer/features/content-search/ContentSearchView';
import { useI18n } from '@/renderer/i18n/useI18n';
import { sampleQuery, searchItems, searchResult } from '../component-lab/searchSampleData';

export const searchScenarios = [
  'recent',
  'loading',
  'results',
  'empty',
  'failed',
  'selected',
  'previewFailed',
] as const;
export type SearchScenario = (typeof searchScenarios)[number];

/** Deliberately local state: no indexing, saving, personal library or desktop bridge is simulated. */
export function useSearchScenario(scenario: SearchScenario) {
  const { messages } = useI18n();
  const [location, setLocation] = useState<ContentSearchViewProps['location']>({
    query: scenario === 'recent' ? '' : scenario === 'empty' ? '未匹配的内容' : sampleQuery,
    type: 'ALL',
  });
  const [selected, setSelected] = useState<ContentSearchViewProps['selection']['selected']>(
    scenario === 'selected' || scenario === 'previewFailed' ? searchItems[0] : null,
  );
  const [composing, setComposing] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(scenario === 'previewFailed');
  const [openFailed, setOpenFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const { query, type } = location;
  const loading = scenario === 'loading';
  const failed = scenario === 'failed' && !recovered;
  const matching = searchItems
    .filter(
      (item) => (type === 'ALL' || item.source.kind === type) && `${item.title} ${item.preview}`.includes(query.trim()),
    )
    .map((item) => ({ ...item, match: query.trim() ? item.match : ('RECENT' as const) }));
  const search: ContentSearchViewProps['search'] = {
    key: JSON.stringify([query, type, recovered]),
    result: loading || failed ? null : searchResult(matching),
    busy: loading,
    error: failed ? 'DEMO_LOOKUP_FAILED' : '',
    paused,
    page: 1,
    hasPrevious: false,
    canPage: false,
    refresh: () => setRecovered(true),
    pause: () => setPaused((value) => !value),
    // The fixed three-item sample has no further pages; pagination is not rendered.
    more: () => {},
    previous: () => {},
  };
  const selection: ContentSearchViewProps['selection'] = {
    selected,
    busy: false,
    error: '',
    select: async (item) => {
      setSelected(item);
      setPreviewFailed(false);
      setOpenFailed(false);
      return true;
    },
  };
  const opening: ContentSearchViewProps['opening'] = {
    busy: false,
    error: openFailed ? messages.referenceOutline.lookup.notAvailable : '',
    // No source exists in a real library. Keep the actual unavailable-source path visible.
    open: async () => {
      setOpenFailed(true);
    },
  };
  const onNavigate: ContentSearchViewProps['onNavigate'] = (next) => {
    setLocation(next);
    setOpenFailed(false);
  };
  return {
    location,
    search,
    selection,
    opening,
    composing,
    onNavigate,
    onComposing: setComposing,
    previewFailed,
    retryPreview: () => setPreviewFailed(false),
  };
}
