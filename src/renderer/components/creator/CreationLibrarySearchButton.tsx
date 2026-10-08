import { SearchIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CreationLibrarySearchButton(props: ComponentProps<typeof Button>) {
  const labels = useI18n().messages.creator.results;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      title={labels.search}
      aria-label={labels.search}
      {...props}
    >
      <SearchIcon className="size-4" aria-hidden />
    </Button>
  );
}
