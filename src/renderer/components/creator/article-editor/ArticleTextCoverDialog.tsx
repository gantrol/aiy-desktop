import { useEffect, useRef, useState } from 'react';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { TextCoverDialog } from '@/renderer/features/text-covers/TextCoverDialog';
import { importVideoDocumentEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { ArticleCoverRatio } from '@/shared/article-covers';
import type { ArticleContentInput } from '@/shared/contracts';
import { textCoverSourceSchema, type TextCoverSource } from '@/shared/contracts/text-cover-source';

function selection(content: ArticleContentInput, ratio: ArticleCoverRatio) {
  return JSON.stringify([content.coverAssetId, content.coverVariants?.find((variant) => variant.ratio === ratio)]);
}

export function ArticleTextCoverDialog({ ratio, onClose }: { ratio?: ArticleCoverRatio; onClose(): void }) {
  const session = useArticleEditorSession();
  const [original] = useState(() => ({
    identity: session.getEditorSessionIdentity(),
    content: session.captureSnapshot(),
  }));
  const sources =
    original.content.coverVariants?.flatMap((variant) => (variant.textSource ? [variant.textSource] : [])) ?? [];
  const media = session.model.getSnapshot().draft.media;
  const sourcePreviews = Object.fromEntries(
    (original.content.coverVariants ?? []).flatMap((variant) => {
      const asset = media.find((candidate) => candidate.assetId === variant.assetId);
      return asset && variant.textSource ? [[variant.ratio, asset.mediaUrl]] : [];
    }),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function assertTarget(selectedRatio: ArticleCoverRatio) {
    if (
      !mounted.current ||
      (ratio && ratio !== selectedRatio) ||
      original.identity !== session.getEditorSessionIdentity() ||
      selection(original.content, selectedRatio) !== selection(session.captureSnapshot(), selectedRatio)
    )
      throw new Error('COVER_CHANGED');
  }
  async function apply(file: File, selectedRatio: ArticleCoverRatio, input: TextCoverSource) {
    const source = textCoverSourceSchema.parse(input);
    if (source.ratio !== selectedRatio) throw new Error('COVER_CHANGED');
    assertTarget(selectedRatio);
    const image = await importVideoDocumentEditorImage(file, 'UPLOAD');
    assertTarget(selectedRatio);
    const assetId = image.media.assetId;
    if (
      !session.coverVariantChanged(
        selectedRatio,
        {
          ratio: selectedRatio,
          assetId,
          sourceAssetId: assetId,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
          textSource: source,
        },
        [image],
      )
    )
      throw new Error('COVER_CHANGED');
  }
  return (
    <TextCoverDialog
      title={original.content.title}
      seed={session.capturePersistedArticle().id}
      initialRatio={ratio}
      fixedRatio={Boolean(ratio)}
      sources={sources}
      sourcePreviews={sourcePreviews}
      onApply={apply}
      onClose={onClose}
    />
  );
}
