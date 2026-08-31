import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';
import { commandAriaShortcut, commandShortcutText } from '@/renderer/commands/app-shortcuts';

interface Props {
  label: string;
  summary: string;
  onReturn(): void;
}

export function ReturnToMaterialsBar({ label, summary, onReturn }: Props) {
  const platform = window.desktopApi.appPlatform;
  const shortcut = commandShortcutText('navigation.back', platform).split('+');
  return (
    <nav className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/55 px-3" aria-label={label}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-keyshortcuts={commandAriaShortcut('navigation.back', platform)}
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
        {shortcut.map((token) => (
          <Kbd key={token}>{token}</Kbd>
        ))}
      </KbdGroup>
    </nav>
  );
}
