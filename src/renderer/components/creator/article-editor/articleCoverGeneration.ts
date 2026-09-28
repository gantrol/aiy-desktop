import { ARTICLE_COVER_RATIOS, type ArticleCoverRatio } from '@/shared/article-covers';
import type { BootstrapDto, GenerationTaskDto } from '@/shared/contracts';

export interface ArticleCoverGeneration {
  visualId: string;
  task: GenerationTaskDto;
}

export type ArticleCoverGenerations = Partial<Record<ArticleCoverRatio, ArticleCoverGeneration>>;

/** Project the live queue onto cover slots without tying task lifetime to the editor. */
export function articleCoverGenerations(
  data: Pick<BootstrapDto, 'derivedVisuals' | 'generationTasks'>,
  articleId: string,
): ArticleCoverGenerations {
  const visuals = new Map(
    (data.derivedVisuals ?? [])
      .filter((visual) => visual.articleId === articleId && visual.role === 'ARTICLE_HEADER' && visual.promptSeriesId)
      .map((visual) => [visual.promptSeriesId, visual]),
  );
  const result: ArticleCoverGenerations = {};
  for (const task of data.generationTasks) {
    const visual = visuals.get(task.seriesId);
    if (!visual) continue;
    // Legacy workspaces target the shared cover, which supplies every ratio.
    for (const ratio of visual.coverRatio ? [visual.coverRatio] : ARTICLE_COVER_RATIOS) {
      const current = result[ratio]?.task;
      if (
        !current ||
        (task.status === 'RUNNING' && current.status === 'QUEUED') ||
        (task.status === current.status && task.submittedAt > current.submittedAt)
      )
        result[ratio] = { visualId: visual.id, task };
    }
  }
  return result;
}
