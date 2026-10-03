import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Command, CommandInput, CommandItem, CommandList } from '@/renderer/components/ui/command';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { AuthorProfileForm } from '@/renderer/features/me/AuthorProfileForm';
import { AuthorPickerResults } from '@/renderer/features/me/AuthorPickerResults';
import { AuthorPickerPagination } from '@/renderer/features/me/AuthorPickerPagination';
import { AuthorWorks } from '@/renderer/features/me/AuthorWorks';
import { useAuthorSearch } from '@/renderer/features/me/useAuthorSearch';
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
  const copy = messages.me.authors;
  const search = useAuthorSearch(spaceId);
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState('');
  const [error, setError] = useState<'candidatesChanged' | 'saveFailed' | null>(null);
  const [detail, setDetail] = useState<{ kind: 'edit' | 'works'; author: Author } | null>(null);
  const busy = controller.saving || controller.loading;
  const disabled = busy || Boolean(controller.pendingAssignment);
  const selected = controller.value?.authors ?? [];
  const result = search.result;
  const name = search.term.trim();
  const canCreate = Boolean(name && result?.nameMatch.token);

  useEffect(() => {
    if (!detail && !disabled) input.current?.focus();
  }, [detail, disabled]);

  async function run(action: () => Promise<boolean>) {
    setError(null);
    try {
      if (await action()) input.current?.focus();
    } catch (failure) {
      const candidatesChanged = String(failure).includes('AUTHOR_CANDIDATES_CHANGED');
      setError(candidatesChanged ? 'candidatesChanged' : 'saveFailed');
      if (candidatesChanged || String(failure).includes('AUTHOR_CHANGED')) search.reload();
    }
  }
  function select(authorId: string | null) {
    void run(() =>
      controller.assign(
        authorId
          ? {
              kind: selected.some((author) => author.id === authorId) ? 'REMOVE' : 'EXISTING',
              authorId,
            }
          : { kind: 'UNSET' },
      ),
    );
  }
  function create() {
    if (!name || !result?.nameMatch.token || disabled) return;
    const selection = {
      kind: 'NEW' as const,
      fields: { name, avatarDataUrl: null },
      requestId: crypto.randomUUID(),
      nameMatchToken: result.nameMatch.token,
    };
    void run(async () => {
      const saved = await controller.assign(selection);
      if (saved) search.setTerm('');
      return saved;
    });
  }

  if (detail)
    return (
      <div
        data-author-detail=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) setDetail(null);
          }
        }}
      >
        {detail.kind === 'works' ? (
          <AuthorWorks spaceId={spaceId} author={detail.author} onBack={() => setDetail(null)} />
        ) : (
          <AuthorProfileForm
            key={detail.author.id}
            initial={{ name: detail.author.name, avatarDataUrl: detail.author.avatarDataUrl }}
            busy={busy}
            onCancel={() => setDetail(null)}
            onSave={async (fields) => {
              const saved = await controller.update(detail.author, fields);
              if (saved) setDetail(null);
              return saved;
            }}
          />
        )}
      </div>
    );

  return (
    <div className="grid gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={copy.selected}>
          {selected.map((author) => (
            <Button
              key={author.id}
              variant="secondary"
              size="sm"
              className="h-7 max-w-full gap-1 px-2"
              disabled={disabled}
              aria-label={copy.remove(authorDisplayName(author, messages))}
              onClick={() => select(author.id)}
            >
              <span className="truncate">{authorDisplayName(author, messages)}</span>
              <XIcon aria-hidden="true" className="size-3 shrink-0" />
            </Button>
          ))}
        </div>
      )}
      <Command
        label={copy.search}
        shouldFilter={false}
        value={active}
        onValueChange={setActive}
        onKeyDownCapture={(event) => {
          // Committing an IME candidate must never select or create an author.
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
            event.stopPropagation();
        }}
      >
        <CommandInput
          ref={input}
          value={search.term}
          placeholder={copy.search}
          aria-label={copy.search}
          maxLength={200}
          disabled={disabled}
          onValueChange={(value) => {
            search.setTerm(value);
            setActive('');
            setError(null);
          }}
        />
        <CommandList ariaLabel={copy.search} className="max-h-64" aria-busy={search.loading}>
          {search.loading ? (
            <div className="p-2 text-xs text-muted-foreground" role="status">
              {messages.me.loading}
            </div>
          ) : search.failed ? (
            <Button variant="ghost" size="sm" onClick={search.reload}>
              {copy.retry}
            </Button>
          ) : (
            <>
              <AuthorPickerResults
                authors={result?.authors ?? []}
                selected={selected}
                disabled={disabled}
                onSelect={select}
                onEdit={(author) => setDetail({ kind: 'edit', author })}
                onWorks={(author) => setDetail({ kind: 'works', author })}
              />
              {!result?.authors.length && <div className="p-2 text-xs text-muted-foreground">{copy.empty}</div>}
              {canCreate && (
                <CommandItem value="create-author" disabled={disabled} onSelect={create}>
                  <PlusIcon className="size-3.5 shrink-0" />
                  <span className="break-words">
                    {result!.nameMatch.count ? copy.createSameName(name) : copy.createNamed(name)}
                  </span>
                </CommandItem>
              )}
            </>
          )}
        </CommandList>
      </Command>
      <AuthorPickerPagination
        offset={search.offset}
        nextOffset={result?.nextOffset ?? null}
        disabled={search.loading || disabled}
        onChange={(offset) => {
          search.setOffset(offset);
          setActive('');
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {copy[error]}
        </span>
      )}
      {error && !controller.pendingAssignment && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            controller.retry();
            search.reload();
            setError(null);
          }}
        >
          {copy.retry}
        </Button>
      )}
      {controller.pendingAssignment && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(controller.retryAssignment)}>
          {copy.retrySave}
        </Button>
      )}
      {controller.value?.legacyAuthor && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => select(controller.value!.legacyAuthor!.id)}
        >
          {copy.useLegacy(authorDisplayName(controller.value.legacyAuthor, messages))}
        </Button>
      )}
      {Boolean(selected.length || controller.value?.legacyAuthor) && (
        <Button variant="ghost" size="sm" className="justify-self-end" disabled={disabled} onClick={() => select(null)}>
          {copy.unset}
        </Button>
      )}
    </div>
  );
}
