import { useRef, useState } from 'react';
import { ChevronDownIcon, FileTextIcon, GalleryVerticalEndIcon, ListTreeIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useHoverDropdown } from '@/renderer/components/ui/use-hover-dropdown';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  busy: boolean;
  collapsed: boolean;
  newAlbumLabel?: string;
  onNewCreation(): void;
  onNewDocument(mode: 'outline' | 'manuscript'): void;
  onNewAlbum(): void;
}

export function CreationLibraryNewButton({
  busy,
  collapsed,
  newAlbumLabel,
  onNewCreation,
  onNewDocument,
  onNewAlbum,
}: Props) {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const hover = useHoverDropdown(open, setOpen, busy);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef(false);
  const escaped = useRef(false);

  function select(action: () => void) {
    if (busy) return;
    selected.current = true;
    hover.rootProps.onOpenChange(false);
    action();
  }

  return (
    <DropdownMenu {...hover.rootProps}>
      <DropdownMenuTrigger
        asChild
        {...hover.triggerProps}
        onPointerEnter={(event) => {
          if (!open) {
            selected.current = false;
            escaped.current = false;
          }
          hover.triggerProps.onPointerEnter?.(event);
        }}
        onPointerDown={(event) => {
          // The trigger always keeps its primary action, including after hover opens the menu.
          if (event.button === 0 && !event.ctrlKey) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(onNewCreation);
          } else {
            selected.current = false;
            escaped.current = false;
            hover.triggerProps.onKeyDown?.(event);
          }
        }}
      >
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative"
          data-action="new-creation"
          disabled={busy}
          title={messages.creator.results.newCreation}
          aria-label={messages.creator.results.newCreation}
          onClick={() => select(onNewCreation)}
        >
          <PlusIcon className="size-4" aria-hidden />
          <ChevronDownIcon className="absolute bottom-0.5 right-0.5 size-2.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...hover.contentProps}
        side={collapsed ? 'right' : 'bottom'}
        align="start"
        onEscapeKeyDown={() => {
          escaped.current = true;
        }}
        onCloseAutoFocus={(event) => {
          // A selected action hands focus to the editor or the inline album name field.
          if (selected.current || escaped.current) {
            event.preventDefault();
            if (escaped.current) trigger.current?.focus({ preventScroll: true });
          } else hover.contentProps.onCloseAutoFocus?.(event);
        }}
      >
        <DropdownMenuItem data-action="new-album" onSelect={() => select(onNewAlbum)}>
          <GalleryVerticalEndIcon aria-hidden />
          {newAlbumLabel ?? messages.creator.album.newAlbum}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => select(() => onNewDocument('outline'))}>
          <ListTreeIcon aria-hidden />
          {messages.creator.results.newOutline}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => select(() => onNewDocument('manuscript'))}>
          <FileTextIcon aria-hidden />
          {messages.creator.results.newArticle}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
