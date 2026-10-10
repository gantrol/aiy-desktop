import type { VideoSearchItem } from '@/shared/contracts/video-search';

type Candidate = { item: VideoSearchItem; rankScore: number };
const groupKey = (item: VideoSearchItem) => `${item.documentId}:${Math.floor(item.startMs / 1000)}`;
const ranked = (values: Map<string, Candidate>) =>
  [...values.entries()].sort((a, b) => b[1].rankScore - a[1].rankScore || a[0].localeCompare(b[0]));

/** Bound each channel by unique time groups before reciprocal rank fusion. */
export class VideoSearchRanking {
  private semantic = new Map<string, Candidate>();
  private lexical = new Map<string, Candidate>();
  constructor(private hybrid: boolean) {}

  private addTo(channel: Map<string, Candidate>, item: VideoSearchItem, rankScore: number) {
    const key = groupKey(item);
    const previous = channel.get(key);
    if (!previous || rankScore > previous.rankScore || (rankScore === previous.rankScore && item.id < previous.item.id))
      channel.set(key, { item, rankScore });
    if (channel.size > 2000) {
      const keep = ranked(channel).slice(0, 1000);
      channel.clear();
      for (const [key, value] of keep) channel.set(key, value);
    }
  }

  add(item: VideoSearchItem, hasVector: boolean, lexical: number) {
    if (hasVector) this.addTo(this.semantic, item, item.score);
    if (this.hybrid && lexical > 0) this.addTo(this.lexical, { ...item, lexicalMatch: true }, lexical);
  }

  results() {
    const semantic = ranked(this.semantic).slice(0, 1000);
    if (!this.hybrid) return semantic.map(([, candidate]) => candidate.item);
    const fused = new Map<string, { item: VideoSearchItem; score: number }>();
    for (const [index, [key, candidate]] of semantic.entries())
      fused.set(key, { item: candidate.item, score: 1 / (60 + index + 1) });
    for (const [index, [key, candidate]] of ranked(this.lexical).slice(0, 1000).entries()) {
      const previous = fused.get(key);
      // Show the exact timed text when that group also has a lexical hit.
      fused.set(key, { item: candidate.item, score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
    }
    return [...fused.values()]
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
      .slice(0, 1000)
      .map((candidate) => candidate.item);
  }
}
