import { useState } from 'react';
import { automaticTextCover, type TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';
import type { ArticleCoverRatio } from '@/shared/article-covers';
import type { TextCoverSource } from '@/shared/contracts/text-cover-source';

interface Draft {
  title: string;
  recipe: TextCoverRecipe;
}

/** Ratio edits stay separate. Only the explicitly applied ratio becomes article content. */
export function useTextCoverDrafts(
  title: string,
  seed: string,
  initialRatio: ArticleCoverRatio,
  sources: readonly TextCoverSource[],
) {
  const [state, setState] = useState(() => {
    const drafts: Partial<Record<ArticleCoverRatio, Draft>> = {};
    for (const source of sources) drafts[source.ratio] = { title: source.title, recipe: { ...source.recipe } };
    drafts[initialRatio] ??= { title, recipe: automaticTextCover(seed) };
    return { ratio: initialRatio, drafts };
  });
  const current = state.drafts[state.ratio]!;

  function update(change: Partial<Draft>) {
    setState((previous) => ({
      ...previous,
      drafts: {
        ...previous.drafts,
        [previous.ratio]: { ...previous.drafts[previous.ratio]!, ...change },
      },
    }));
  }

  function changeRatio(ratio: ArticleCoverRatio) {
    setState((previous) => {
      if (previous.ratio === ratio) return previous;
      const previousDraft = previous.drafts[previous.ratio]!;
      return {
        ratio,
        drafts: {
          ...previous.drafts,
          [ratio]: previous.drafts[ratio] ?? { title: previousDraft.title, recipe: { ...previousDraft.recipe } },
        },
      };
    });
  }

  function accept(source: TextCoverSource) {
    setState((previous) => ({
      ratio: source.ratio,
      drafts: { ...previous.drafts, [source.ratio]: { title: source.title, recipe: { ...source.recipe } } },
    }));
  }

  return { ...current, ratio: state.ratio, update, changeRatio, accept };
}
