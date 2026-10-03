import { UserRoundIcon } from 'lucide-react';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import type { ContentWriteContext } from '@/shared/contracts/authorship';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useNavigationPopoverState } from '@/renderer/components/ui/popover-navigation-scope';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { AuthorPicker } from '@/renderer/features/me/AuthorPicker';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { useCreationAuthor } from '@/renderer/features/me/useCreationAuthor';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  ContentWriteContextDetails,
  hasContentWriteContextDetails,
} from '@/renderer/features/content-provenance/ContentWriteContext';

export function CreationAuthor({
  spaceId,
  target,
  editable = true,
  writeContext,
}: {
  spaceId: string;
  target: CreationFormEntityRef;
  editable?: boolean;
  writeContext?: ContentWriteContext;
}) {
  const { messages } = useI18n(),
    copy = messages.me.authors;
  const controller = useCreationAuthor(spaceId, target);
  const [open, setOpen] = useNavigationPopoverState();
  const { value, loading, failed } = controller;
  if (loading && !value) return <Skeleton className="h-7 w-24 rounded-sm" aria-label={messages.me.loading} />;
  if (failed && !value)
    return (
      <Button variant="ghost" size="sm" onClick={controller.retry}>
        {copy.retry}
      </Button>
    );
  if (!value) return null;
  const name = value.authors.map((author) => authorDisplayName(author, messages)).join(' · ');
  const first = value.authors[0];
  const content = (
    <>
      {first?.kind === 'AI' ? (
        <UserRoundIcon aria-hidden="true" className="size-6 text-muted-foreground" />
      ) : (
        first && <ProfileAvatar src={first.avatarDataUrl} className="size-6" />
      )}
      <span className="max-w-48 truncate">{name || copy.set}</span>
    </>
  );
  if (!editable)
    return name ? (
      <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground">{content}</span>
    ) : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!controller.saving) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 gap-2 px-1 text-muted-foreground"
          aria-label={name ? copy.change + ': ' + name : copy.set}
        >
          {content}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        hideWhenDetached
        onEscapeKeyDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('[data-author-detail]'))
            event.preventDefault();
        }}
        className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
      >
        {open && (
          <AuthorPicker key={`${spaceId}:${target.kind}:${target.id}`} spaceId={spaceId} controller={controller} />
        )}
        {open && hasContentWriteContextDetails(writeContext) && (
          <div className="mt-3 border-t border-border pt-3">
            <ContentWriteContextDetails value={writeContext} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
