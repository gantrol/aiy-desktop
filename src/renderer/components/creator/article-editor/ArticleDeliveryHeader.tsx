import { HistoryIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ArticleDeliveryPresetMenu } from '@/renderer/components/creator/article-editor/ArticleDeliveryPresetMenu';
import type {
  ArticleDeliveryPreferences,
  ArticleUploadTarget,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleDeliveryHeader({
  busy,
  locked,
  loading,
  preferences,
  selectable,
  configured,
  onRefresh,
  onOpenHistory,
  onChange,
  notify,
}: {
  busy: boolean;
  locked: boolean;
  loading: boolean;
  preferences: ArticleDeliveryPreferences;
  selectable: ArticleUploadTarget[];
  configured: ArticleUploadTarget[];
  onRefresh(): void;
  onOpenHistory(): void;
  onChange(preferences: ArticleDeliveryPreferences): void;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const copy = messages.articleDelivery.batch;
  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-4 py-3 pr-12">
      <DialogHeader className="mr-auto">
        <DialogTitle className="text-base">{copy.title}</DialogTitle>
      </DialogHeader>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={locked || loading}
        aria-label={copy.refresh}
        title={copy.refresh}
        onClick={onRefresh}
      >
        <RefreshCwIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={messages.articleDelivery.history}
        title={messages.articleDelivery.history}
        onClick={onOpenHistory}
      >
        <HistoryIcon className="size-4" />
      </Button>
      <ArticleDeliveryPresetMenu
        disabled={locked}
        loading={loading}
        preferences={preferences}
        selectable={selectable}
        configured={configured}
        onChange={onChange}
        notify={notify}
      />
    </div>
  );
}
