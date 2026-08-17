import { FolderInputIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';

interface Props {
  title: string;
  savedTitle: string;
  titleLabel: string;
  albumTitle: string;
  saving: boolean;
  onTitleChange(title: string): void;
  onSaveTitle(): void;
  onMove(): void;
}

export function VideoDocumentHeader({
  title,
  savedTitle,
  titleLabel,
  albumTitle,
  saving,
  onTitleChange,
  onSaveTitle,
  onMove,
}: Props) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
      <Input
        value={title}
        className="h-9 min-w-0 max-w-xl border-transparent px-2 text-lg font-semibold shadow-none hover:border-input focus-visible:border-ring"
        aria-label={titleLabel}
        disabled={saving}
        onChange={(event) => onTitleChange(event.target.value)}
        onBlur={onSaveTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            onTitleChange(savedTitle);
            event.currentTarget.blur();
          }
        }}
      />
      {saving && <LoaderCircleIcon className="size-4 animate-spin text-selected-foreground" />}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="max-w-56" onClick={onMove}>
          <FolderInputIcon className="size-4" />
          <span className="truncate">{albumTitle}</span>
        </Button>
      </div>
    </header>
  );
}
