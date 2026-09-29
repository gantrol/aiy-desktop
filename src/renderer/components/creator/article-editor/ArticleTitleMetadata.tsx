import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon, TextCursorInputIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { CreationAuthor } from '@/renderer/features/me/CreationAuthor';
import type { ContentWriteContext } from '@/shared/contracts/authorship';
import { useI18n } from '@/renderer/i18n/useI18n';
import { SuggestedArticleTitle } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  selectArticleEditorHasBody,
  selectArticleEditorTitle,
} from '@/renderer/components/creator/article-editor/articleEditorSession';

export function ArticleTitleMetadata({
  spaceId,
  articleId,
  editable,
  writeContext,
  notify,
}: {
  spaceId: string;
  articleId: string;
  editable: boolean;
  writeContext?: ContentWriteContext;
  notify(message: string): void;
}) {
  const session = useArticleEditorSession();
  const label = useI18n().messages.creator.manuscriptEditor.aiTitle;
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const title = useArticleEditorSessionSelector(selectArticleEditorTitle);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);
  const request = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    setSuggestedTitle(null);
    const current = ++request.current;
    return () => {
      request.current = current + 1;
    };
  }, [title, editable]);

  async function suggestTitle() {
    if (locked.current || !editable) return;
    const content = session.captureSnapshot();
    const prompt = content.markdown.trim();
    if (!prompt) return;
    const current = request.current;
    locked.current = true;
    setSuggesting(true);
    try {
      const result = await window.desktopApi.codexSuggestTitles({
        prompt: prompt.slice(0, 30_000),
        title: content.title,
        mode: content.title.trim() ? 'regenerate' : 'fill',
      });
      if (current === request.current) setSuggestedTitle(result.title.trim() || null);
    } catch (reason) {
      if (current === request.current) notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      locked.current = false;
      setSuggesting(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CreationAuthor
          spaceId={spaceId}
          target={{ kind: 'ARTICLE', id: articleId }}
          editable={editable}
          writeContext={writeContext}
        />
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!hasBody || suggesting}
            onClick={() => void suggestTitle()}
          >
            {suggesting ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <TextCursorInputIcon className="size-3.5" />
            )}
            {label}
          </Button>
        )}
      </div>
      {editable && suggestedTitle && (
        <SuggestedArticleTitle
          title={suggestedTitle}
          onApply={() => {
            session.titleChanged(suggestedTitle);
            setSuggestedTitle(null);
          }}
          onDismiss={() => setSuggestedTitle(null)}
        />
      )}
    </div>
  );
}
