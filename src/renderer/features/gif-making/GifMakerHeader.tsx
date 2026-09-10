import type { ReactNode } from 'react';
import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
import type { GifLaunchInput } from '@/renderer/features/gif-making/GifMakerProvider';
export function GifMakerHeader({
  model,
  workNavigation,
  onOpen,
  onCopy,
  onClose,
  onTitleChange,
}: {
  model: GifMakerModel;
  workNavigation?: ReactNode;
  onOpen(input: GifLaunchInput): Promise<void>;
  onCopy(): Promise<void>;
  onClose(): Promise<void>;
  onTitleChange(title: string): void;
}) {
  const { labels, project, document, exporting, busy, safe } = model;
  return (
    <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <Button
        data-action="gif-close"
        size="icon-sm"
        variant="ghost"
        aria-label={labels.close}
        disabled={busy}
        onClick={() => safe(onClose)}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <h2 className="text-sm font-medium">{labels.workspaceTitle}</h2>
      <Input
        aria-label={labels.projectTitle}
        data-control="gif-project-title"
        placeholder={labels.untitled}
        value={document.title}
        maxLength={200}
        disabled={busy || exporting}
        onChange={(event) => onTitleChange(event.target.value)}
        className="h-8 min-w-24 flex-1"
      />
      {workNavigation}
      <span role="status" className="shrink-0 text-xs text-muted-foreground">
        {project.saving ? labels.saving : project.dirty || project.conflicted ? labels.unsaved : labels.saved}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-action="gif-project-actions"
            size="icon-sm"
            variant="ghost"
            aria-label={labels.projectActions}
            disabled={busy || exporting}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-action="gif-save-project"
            disabled={project.saving || project.conflicted}
            onSelect={() => safe(project.save)}
          >
            {labels.save}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => safe(onCopy)}>{labels.saveCopy}</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => safe(() => onOpen({ seriesId: document.seriesId, sourceDocumentId: document.id }))}
          >
            {labels.newProject}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
