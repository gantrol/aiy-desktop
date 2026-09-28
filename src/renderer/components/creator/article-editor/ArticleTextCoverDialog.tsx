import { useEffect, useRef } from 'react';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { TextCoverDialog } from '@/renderer/features/text-covers/TextCoverDialog';
import { importVideoDocumentEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { ArticleCoverRatio } from '@/shared/article-covers';
import type { ArticleContentInput } from '@/shared/contracts';

function selection(content: ArticleContentInput, ratio: ArticleCoverRatio) {
  return JSON.stringify([content.coverAssetId, content.coverVariants?.find((variant) => variant.ratio === ratio)]);
}

export function ArticleTextCoverDialog({ ratio, onClose }: { ratio?: ArticleCoverRatio; onClose(): void }) {
  const session = useArticleEditorSession();
  const original = useRef({ identity: session.getEditorSessionIdentity(), content: session.captureSnapshot() });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function apply(file: File, selectedRatio: ArticleCoverRatio) {
    const image = await importVideoDocumentEditorImage(file, 'UPLOAD');
    if (
      !mounted.current ||
      original.current.identity !== session.getEditorSessionIdentity() ||
      selection(original.current.content, selectedRatio) !== selection(session.captureSnapshot(), selectedRatio)
    ) {
      throw new Error('COVER_CHANGED');
    }
    const assetId = image.media.assetId;
    if (
      !session.coverVariantChanged(
        selectedRatio,
        {
          ratio: selectedRatio,
          assetId,
          sourceAssetId: assetId,
          crop: { x: 0.5, y: 0.5, zoom: 1 },
        },
        [image],
      )
    )
      throw new Error('COVER_CHANGED');
  }
  return (
    <TextCoverDialog
      title={original.current.content.title}
      seed={session.capturePersistedArticle().id}
      initialRatio={ratio}
      fixedRatio={Boolean(ratio)}
      onApply={apply}
      onClose={onClose}
    />
  );
}
