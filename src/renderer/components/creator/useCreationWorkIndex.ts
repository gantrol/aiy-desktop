import { useMemo } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import { buildCreationFormEntityIndex } from '@/renderer/components/creator/creationLibraryProjection';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';

export function useCreationWorkIndex(data: BootstrapDto) {
  return useMemo(
    () =>
      buildCreationFormEntityIndex({
        series: data.series,
        sessions: buildCreationSessionProjection(data.series, data.styleExplorationBatches),
        animations: data.animations,
        articles: data.articles ?? [],
        socialPosts: data.socialPosts ?? [],
        imageBreakdowns: data.imageBreakdowns ?? [],
        evaluationSuites: data.evaluationSuites ?? [],
        inspirationStashes: data.inspirationStashes ?? [],
        derivedVisuals: data.derivedVisuals ?? [],
        videoDocuments: [],
      }),
    [
      data.series,
      data.styleExplorationBatches,
      data.animations,
      data.articles,
      data.socialPosts,
      data.imageBreakdowns,
      data.evaluationSuites,
      data.inspirationStashes,
      data.derivedVisuals,
    ],
  );
}
