import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';
import { AuthorPickerPagination } from '@/renderer/features/me/AuthorPickerPagination';
import type { Author, MeApi } from '@/shared/contracts/me';

export function AuthorWorks({ spaceId, author, onBack }: { spaceId: string; author: Author; onBack(): void }) {
  const { messages } = useI18n();
  const copy = messages.me.authors;
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<MeApi['authorWorks']>>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    setFailed(false);
    void window.desktopApi.me.authorWorks({ spaceId, authorId: author.id, offset }).then(
      (next) => active && setResult(next),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [spaceId, author.id, offset, retry]);
  return (
    <div className="grid gap-2">
      <Button variant="ghost" size="sm" className="justify-start" onClick={onBack} autoFocus>
        <ArrowLeftIcon className="size-4" />
        {copy.back}
      </Button>
      <div className="text-sm font-medium">{copy.worksFor(authorDisplayName(author, messages))}</div>
      {failed ? (
        <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
          {copy.retry}
        </Button>
      ) : !result ? (
        <span role="status" className="text-xs text-muted-foreground">
          {messages.me.loading}
        </span>
      ) : (
        <ul className="max-h-64 overflow-y-auto text-sm">
          {result.works.length ? (
            result.works.map((work) => (
              <li key={work.id} className="break-words py-1.5">
                {work.title || copy.untitledWork}
              </li>
            ))
          ) : (
            <li className="py-1.5 text-xs text-muted-foreground">{copy.noWorks}</li>
          )}
        </ul>
      )}
      <AuthorPickerPagination
        offset={offset}
        nextOffset={result?.nextOffset ?? null}
        disabled={!result}
        onChange={setOffset}
      />
    </div>
  );
}
