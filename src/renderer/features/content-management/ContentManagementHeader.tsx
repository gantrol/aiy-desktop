import { ArrowLeftIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  embedded: boolean;
  canNavigateBack: boolean;
  onNavigateBack(): void;
  total: number | null;
  canClear: boolean;
  busy: boolean;
  onClear(): void;
}

export function ContentManagementHeader({
  embedded,
  canNavigateBack,
  onNavigateBack,
  total,
  canClear,
  busy,
  onClear,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.contentManagement;
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      {!embedded && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canNavigateBack}
          aria-label={messages.app.navigation.back}
          onClick={onNavigateBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
      )}
      {embedded ? (
        <h2 className="text-sm font-semibold">{labels.title}</h2>
      ) : (
        <h1 className="text-base font-semibold">{labels.title}</h1>
      )}
      {total !== null && <MetaText>{labels.count(total)}</MetaText>}
      {canClear && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onClear}
        >
          <Trash2Icon className="size-3.5" />
          {labels.actions.clear}
        </Button>
      )}
    </header>
  );
}
