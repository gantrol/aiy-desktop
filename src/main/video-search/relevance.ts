import type { VideoSearchItem, VideoSearchResult } from '@/shared/contracts/video-search';
import { searchRelevanceBoundaries } from '@/shared/search-relevance';

/** Trial labels for this Q8 single-frame pipeline, not a probability or an exclusion threshold. */
export function isVideoSearchBorderline(score: number, kind: VideoSearchItem['kind']) {
  return score < searchRelevanceBoundaries[kind === 'FRAME' ? 'videoFrame' : 'videoText'];
}

/** Summarize the full candidate set before pagination; a later page must not change this state. */
export function videoSearchRelevance(items: VideoSearchItem[]): VideoSearchResult['relevance'] {
  if (!items.length) return 'EMPTY';
  return items.some((item) => item.lexicalMatch || !item.borderline) ? 'CANDIDATES' : 'BORDERLINE';
}
