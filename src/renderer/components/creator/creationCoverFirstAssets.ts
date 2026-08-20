import type { PromptSeriesDto } from '@/shared/contracts';
import { allAssets } from '@/renderer/components/creator/utils';

function creationCovers(series: PromptSeriesDto) {
  return series.covers?.length ? series.covers : series.cover ? [series.cover] : [];
}

export function creationCoverFirstAssets(series: PromptSeriesDto) {
  const assets = allAssets(series);
  const covers = creationCovers(series);
  if (!covers.length) return assets;
  const coverIds = new Set(covers.map((asset) => asset.id));
  return [...covers, ...assets.filter((asset) => !coverIds.has(asset.id))];
}

export function creationSessionCoverFirstAssets(session: {
  primarySeries: PromptSeriesDto;
  memberSeries: readonly PromptSeriesDto[];
}) {
  const groups = session.memberSeries.map((series) =>
    allAssets(series).map((asset) => ({ asset, seriesId: series.id })),
  );
  const recordsByAssetId = new Map(groups.flat().map((record) => [record.asset.id, record]));
  const preferredAssets = [
    ...creationCovers(session.primarySeries),
    ...session.memberSeries
      .filter((series) => series.id !== session.primarySeries.id)
      .flatMap((series) => creationCovers(series).slice(0, 1)),
  ];
  const candidates = [
    ...preferredAssets.flatMap((asset) => {
      const record = recordsByAssetId.get(asset.id);
      return record ? [record] : [];
    }),
    ...groups.flatMap((records) => records.slice(0, 1)),
    ...groups.flatMap((records) => records.slice(1)),
  ];
  const seen = new Set<string>();
  return candidates.filter(({ asset }) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}
