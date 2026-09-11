import { useI18n } from '@/renderer/i18n/useI18n';
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

export function InspirationStashAction({ ready, busy, saved, blocked = false, onClick }: Props) {
  const copy = useI18n().messages.desktopPetals.document;
  return (
    <Button
      data-action="stash-inspiration"
      type="button"
      variant="outline"
      size="lg"
      className="shrink-0"
      disabled={!ready || busy || saved || blocked}
      title={!ready ? copy.stashEmpty : saved ? copy.draftSaved : undefined}
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
      {busy ? copy.stashing : saved ? copy.stashed : copy.stash}
    </Button>
  );
}
