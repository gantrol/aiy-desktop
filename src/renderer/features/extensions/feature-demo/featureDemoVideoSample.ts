import { videoDocumentRevisionSchema } from '@/shared/contracts/video-document';
import { videoKeyChangeResultSchema } from '@/shared/contracts/video-key-changes';
import type { FeatureDemoVideoSnapshot } from '@/renderer/features/extensions/feature-demo/useFeatureDemoVideoSnapshot';
import sample from '../../../../../extensions/com.aiy.feature-demo/assets/features/vectors.json';

const imageUrls = import.meta.glob<string>(
  '../../../../../extensions/com.aiy.feature-demo/assets/features/vector-owned-*.svg',
  // Inline data URLs can exceed the document schemas' 1,000-character URL limit.
  { eager: true, import: 'default', query: '?url&no-inline' },
);

function imageUrl(fileName: string) {
  const url = imageUrls[`../../../../../extensions/com.aiy.feature-demo/assets/features/${fileName}`];
  if (!url) throw new Error('Feature demo video image is unavailable');
  return url;
}

export const featureDemoVideoSample: FeatureDemoVideoSnapshot = {
  durationMs: sample.durationMs,
  previewUrl: imageUrl(sample.previewUrl),
  article: videoDocumentRevisionSchema.parse({
    ...sample.article,
    media: sample.article.media.map((media) => ({ ...media, mediaUrl: imageUrl(media.mediaUrl) })),
  }),
  transcript: videoDocumentRevisionSchema.parse(sample.transcript),
  keyChanges: videoKeyChangeResultSchema.parse({
    ...sample.keyChanges,
    candidates: sample.keyChanges.candidates.map((candidate) => ({
      ...candidate,
      imageUrl: imageUrl(candidate.imageUrl),
    })),
  }),
};
