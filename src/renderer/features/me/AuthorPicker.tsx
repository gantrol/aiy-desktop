import { useEffect, useState } from 'react';
import { CheckIcon, PencilIcon, PlusIcon, UserRoundIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ProfileAvatar } from '@/renderer/features/me/ProfileAvatar';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { AuthorProfileForm } from '@/renderer/features/me/AuthorProfileForm';
import { useAuthorUpdates } from '@/renderer/features/me/SpaceProfileProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { Author } from '@/shared/contracts/me';
import type { useCreationAuthor } from '@/renderer/features/me/useCreationAuthor';

export function AuthorPicker({
  spaceId,
  controller,
}: {
  spaceId: string;
  controller: ReturnType<typeof useCreationAuthor>;
}) {
  const { messages } = useI18n();
  const copy = messages.me.authors,
    me = messages.me;
  const [term, setTerm] = useState(''),
    [offset, setOffset] = useState(0);
  const [authors, setAuthors] = useState<Author[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Author | 'NEW' | null>(null);
  const updates = useAuthorUpdates();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(
      () => {
        void window.desktopApi.me.authors({ spaceId, term, offset }).then(
          (result) => {
            if (!active) return;
            setAuthors(result.authors);
            setNextOffset(result.nextOffset);
            setLoading(false);
          },
          () => {
            if (active) {
              setFailed(true);
              setLoading(false);
            }
          },
        );
      },
      term ? 180 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [spaceId, term, offset, retry, updates.revision]);
  const select = async (authorId: string | null) => {
    setMutationFailed(false);
    try {
      await controller.assign(
        authorId
          ? {
              kind: controller.value?.authors.some((author) => author.id === authorId) ? 'REMOVE' : 'EXISTING',
              authorId,
            }
          : { kind: 'UNSET' },
      );
    } catch {
      setMutationFailed(true);
    }
  };
  if (editing)
    return (
      <AuthorProfileForm
        key={editing === 'NEW' ? 'new' : editing.id}
        initial={
          editing === 'NEW'
            ? { name: term, avatarDataUrl: null }
            : { name: editing.name, avatarDataUrl: editing.avatarDataUrl }
        }
        busy={controller.saving}
        onCancel={() => setEditing(null)}
        onSave={async (fields) => {
          const saved =
            editing === 'NEW'
              ? await controller.assign({ kind: 'NEW', fields })
              : await controller.update(editing, fields);
          if (saved) {
            setEditing(null);
          }
          return saved;
        }}
      />
    );
  return (
    <div className="grid gap-2">
      <Input
        value={term}
        placeholder={copy.search}
        aria-label={copy.search}
        maxLength={200}
        disabled={controller.saving}
        onChange={(event) => {
          setTerm(event.target.value);
          setOffset(0);
        }}
      />
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <span className="text-xs text-muted-foreground" role="status">
            {me.loading}
          </span>
        ) : failed ? (
          <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
            {copy.retry}
          </Button>
        ) : authors.length ? (
          authors.map((author) => (
            <div key={author.id} className="flex items-center gap-1">
              <Button
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-2"
                disabled={controller.saving}
                aria-pressed={controller.value?.authors.some((selected) => selected.id === author.id) ?? false}
                onClick={() => void select(author.id)}
              >
                {author.kind === 'AI' ? (
                  <UserRoundIcon className="size-6" />
                ) : (
                  <ProfileAvatar src={author.avatarDataUrl} className="size-6" />
                )}
                <span className="truncate">{authorDisplayName(author, messages)}</span>
                {author.isCurrentUser && <span className="text-xs text-muted-foreground">{copy.me}</span>}
                {controller.value?.authors.some((selected) => selected.id === author.id) && (
                  <CheckIcon className="ml-auto size-3.5 shrink-0" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={controller.saving}
                aria-label={`${copy.edit}: ${authorDisplayName(author, messages)}`}
                title={copy.edit}
                onClick={() => setEditing(author)}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{copy.empty}</span>
        )}
      </div>
      {(offset > 0 || nextOffset !== null) && (
        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || controller.saving || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 30))}
          >
            {me.previous}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || controller.saving || nextOffset === null}
            onClick={() => nextOffset !== null && setOffset(nextOffset)}
          >
            {me.more}
          </Button>
        </div>
      )}
      {mutationFailed && (
        <span role="alert" className="text-xs text-destructive">
          {copy.saveFailed}
        </span>
      )}
      {controller.value?.legacyAuthor && (
        <Button
          variant="ghost"
          size="sm"
          disabled={controller.saving}
          onClick={() => void select(controller.value!.legacyAuthor!.id)}
        >
          {copy.useLegacy(authorDisplayName(controller.value.legacyAuthor, messages))}
        </Button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-2">
        <Button variant="ghost" size="sm" disabled={controller.saving} onClick={() => setEditing('NEW')}>
          <PlusIcon className="size-3.5" />
          {copy.create}
        </Button>
        {Boolean(controller.value?.authors.length || controller.value?.legacyAuthor) && (
          <Button variant="ghost" size="sm" disabled={controller.saving} onClick={() => void select(null)}>
            {copy.unset}
          </Button>
        )}
      </div>
    </div>
  );
}
