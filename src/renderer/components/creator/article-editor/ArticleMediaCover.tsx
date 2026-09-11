import { XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContentMediaThumbnail } from '@/renderer/features/content-editor/ContentMediaThumbnail';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleMediaCover({ media }: { media: readonly VideoDocumentRevisionMediaDto[] }) {
  const copy = useI18n().messages.contentEditor;
  const session = useArticleEditorSession();
  const cover = useArticleEditorSessionSelector((state) => state.draft.metadata.coverAssetId);
  if (!cover) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      <div className="w-9 shrink-0">
        <ContentMediaThumbnail
          assetId={cover}
          mediaUrl={media.find((asset) => asset.assetId === cover)?.mediaUrl}
          index={0}
          label={copy.articleCover}
          actions={[]}
        />
      </div>
      <span className="text-xs text-muted-foreground">{copy.articleCover}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copy.removeArticleCover}
        title={copy.removeArticleCover}
        onClick={() => session.coverChanged(null)}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
