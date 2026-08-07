import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';

interface Props {
  label: string;
  summary: string;
  onReturn(): void;
}

export function ReturnToMaterialsBar({ label, summary, onReturn }: Props) {
  return (
    <nav className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/55 px-3" aria-label={label}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-keyshortcuts="Alt+ArrowLeft"
        onClick={onReturn}
      >
        <ArrowLeftIcon className="size-3.5" />
        {label}
      </Button>
      {summary && (
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={summary}>
          {summary}
        </span>
      )}
      <KbdGroup className="ml-auto hidden shrink-0 sm:inline-flex">
        <Kbd>Alt</Kbd>
        <Kbd>←</Kbd>
      </KbdGroup>
    </nav>
  );
}
