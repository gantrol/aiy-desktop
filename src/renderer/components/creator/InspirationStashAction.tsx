import { BookmarkIcon, CheckIcon, LoaderCircleIcon } from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';

interface Props {
  locale: Locale;
  ready: boolean;
  busy: boolean;
  saved: boolean;
  blocked?: boolean;
  onClick(): void;
}

export function InspirationStashAction({ locale, ready, busy, saved, blocked = false, onClick }: Props) {
  const zh = locale === 'zh';
  return (
    <Button
      data-action="stash-inspiration"
      type="button"
      variant="outline"
      size="lg"
      className="shrink-0"
      disabled={!ready || busy || saved || blocked}
      title={
        !ready
          ? zh
            ? '输入内容后可暂存'
            : 'Enter something to stash'
          : saved
            ? zh
              ? '当前灵感已暂存'
              : 'Current inspiration is stashed'
            : undefined
      }
      aria-busy={busy}
      onClick={onClick}
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : saved ? (
        <CheckIcon className="size-4" />
      ) : (
        <BookmarkIcon className="size-4" />
      )}
      {busy ? (zh ? '暂存中' : 'Stashing') : saved ? (zh ? '已暂存' : 'Stashed') : zh ? '暂存灵感' : 'Stash idea'}
    </Button>
  );
}
