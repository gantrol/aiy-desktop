import { CheckIcon, EllipsisIcon, PencilIcon, LibraryIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { CommandItem } from '@/renderer/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { AuthorAvatar } from '@/renderer/features/me/AuthorAvatar';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { Author } from '@/shared/contracts/me';

export function AuthorPickerResults({
  authors,
  selected,
  disabled,
  onSelect,
  onEdit,
  onWorks,
}: {
  authors: Author[];
  selected: Author[];
  disabled: boolean;
  onSelect(authorId: string): void;
  onEdit(author: Author): void;
  onWorks(author: Author): void;
}) {
  const { messages } = useI18n();
  const copy = messages.me.authors;
  return authors.map((author) => {
    const name = authorDisplayName(author, messages);
    const checked = selected.some((value) => value.id === author.id);
    return (
      <div
        key={author.id}
        className="flex items-center gap-1"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('button,[role="menu"]'))
            event.stopPropagation();
        }}
      >
        <CommandItem
          value={author.id}
          disabled={disabled}
          className="min-w-0 flex-1"
          onSelect={() => onSelect(author.id)}
          aria-label={checked ? copy.remove(name) : copy.select(name)}
        >
          <AuthorAvatar author={author} className="size-6 shrink-0" />
          <span className="min-w-0 truncate">{name}</span>
          {author.isCurrentUser && <span className="text-xs text-muted-foreground">{copy.me}</span>}
          {author.application && author.name && (
            <span className="truncate text-xs text-muted-foreground">
              {authorDisplayName({ ...author, name: '' }, messages)}
            </span>
          )}
          {checked && <CheckIcon aria-hidden="true" className="ml-auto size-3.5 shrink-0" />}
        </CommandItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={copy.actions(name)}
              title={copy.actions(name)}
            >
              <EllipsisIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onWorks(author)}>
              <LibraryIcon className="size-3.5" />
              {copy.works}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(author)}>
              <PencilIcon className="size-3.5" />
              {copy.edit}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  });
}
