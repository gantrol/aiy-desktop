import { useMemo, useState } from 'react';
import { CloudUploadIcon } from 'lucide-react';
import type { ExtensionDto, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ArticleDeliveryDialog } from '@/renderer/components/creator/article-editor/ArticleDeliveryDialog';
import { ArticleDeliveryHistoryDialog } from '@/renderer/components/creator/article-editor/ArticleDeliveryHistoryDialog';
import { ArticleDeliveryIndicator } from '@/renderer/features/article-delivery/ArticleDeliveryIndicator';
import { articleDeliveryTargets } from '@/renderer/features/article-delivery/articleDeliveryTargets';
import {
  naturalWatermarkBrowserCompanionAvailable,
  socialPostBrowserCompanionTargets,
} from '@/renderer/features/browser-companion/browserCompanionTargets';
import { useArticleEditorSessionSelector } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  articleEditorSessionSaving,
  selectArticleEditorHasBody,
} from '@/renderer/components/creator/article-editor/articleEditorSession';

interface ArticleDeliveryActionProps {
  articleId: string;
  extensions: readonly ExtensionDto[];
  locale: Locale;
  notify(message: string): void;
  spaceId: string;
}

export function ArticleDeliveryAction(props: ArticleDeliveryActionProps) {
  return <ArticleDeliveryScopedAction key={JSON.stringify([props.spaceId, props.articleId])} {...props} />;
}

function ArticleDeliveryScopedAction({ articleId, extensions, locale, notify, spaceId }: ArticleDeliveryActionProps) {
  const copy = useI18n().messages.browserCompanion;
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const saving = useArticleEditorSessionSelector(articleEditorSessionSaving);
  const targets = useMemo(() => articleDeliveryTargets(extensions, locale), [extensions, locale]);
  const scope = JSON.stringify([spaceId, articleId]);
  const [dialogScope, setDialogScope] = useState<string | null>(null);
  const [historyScope, setHistoryScope] = useState<string | null>(null);
  return (
    <>
      <div className="inline-flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="content-upload"
              disabled={!hasBody || saving}
              aria-label={copy.upload}
              onClick={() => setDialogScope(scope)}
            >
              <CloudUploadIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{copy.upload}</TooltipContent>
        </Tooltip>
        <ArticleDeliveryIndicator
          articleId={articleId}
          spaceId={spaceId}
          onOpenHistory={() => setHistoryScope(scope)}
        />
      </div>
      {dialogScope === scope && (
        <ArticleDeliveryDialog
          key={scope}
          articleId={articleId}
          spaceId={spaceId}
          targets={targets}
          availableBrowserTargets={socialPostBrowserCompanionTargets(extensions)}
          watermarkAvailable={naturalWatermarkBrowserCompanionAvailable(extensions)}
          notify={notify}
          onClose={() => setDialogScope(null)}
          onOpenHistory={() => setHistoryScope(scope)}
        />
      )}
      <ArticleDeliveryHistoryDialog
        key={`history:${scope}`}
        articleId={articleId}
        spaceId={spaceId}
        targets={targets}
        notify={notify}
        open={historyScope === scope}
        onOpenChange={(open) => setHistoryScope(open ? scope : null)}
      />
    </>
  );
}
