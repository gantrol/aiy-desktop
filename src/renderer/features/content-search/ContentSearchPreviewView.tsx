import { Activity, type ReactNode } from 'react';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';

/** The owning host supplies current content; this view never reads a library. */
export function ContentSearchPreviewView({
  item,
  active,
  current,
  onRetry,
  renderEditor,
}: {
  item: ContentLookupResult['items'][number] | null;
  active: boolean;
  current: { document?: ContentDocument; failed?: boolean } | null;
  onRetry(): void;
  renderEditor(document: ContentDocument, active: boolean): ReactNode;
}) {
  const { messages } = useI18n();
  if (!item)
    return (
      <div className="grid min-h-32 flex-1 place-items-center text-sm text-muted-foreground">
        {messages.workbench.selectResult}
      </div>
    );
  if (current?.failed)
    return (
      <div role="alert" className="flex items-center gap-3 p-4 text-sm">
        {messages.referenceOutline.lookup.notAvailable}
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {messages.workbench.retry}
        </Button>
      </div>
    );
  if (!current?.document)
    return (
      <div role="status" aria-label={messages.workbench.preview} className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  return (
    <div
      key={contentSearchSourceKey(item.source)}
      data-search-preview
      data-search-editor
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <Activity mode={active ? 'visible' : 'hidden'}>{renderEditor(current.document, active)}</Activity>
    </div>
  );
}
