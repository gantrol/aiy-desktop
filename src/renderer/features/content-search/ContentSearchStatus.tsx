import { CheckIcon, LoaderCircleIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentLookupResult } from '@/shared/contracts/content-search';

export function ContentSearchStatus({
  result,
  busy,
  paused,
  disabled,
  onPause,
}: {
  result: ContentLookupResult | null;
  busy: boolean;
  paused: boolean;
  disabled: boolean;
  onPause(): void;
}) {
  const copy = useI18n().messages.referenceOutline.lookup;
  if (!result && !busy) return null;
  const pending = Boolean(result?.coverage.pending);
  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2">
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {busy && !result && <span>{copy.searching}</span>}
        {result && (
          <>
            <span className="inline-flex items-center gap-1.5">
              {pending && !paused ? (
                <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
              ) : result.coverage.ready === result.coverage.total ? (
                <CheckIcon aria-hidden="true" className="size-3" />
              ) : null}
              {copy.progress(result.coverage.ready, result.coverage.total)}
            </span>
            {pending && <span>{paused ? copy.paused : copy.preparing}</span>}
            {result.coverage.unavailable > 0 && (
              <span className="text-warning">{copy.unavailable(result.coverage.unavailable)}</span>
            )}
            {result.coverage.limited > 0 && (
              <span className="text-warning">{copy.limited(result.coverage.limited)}</span>
            )}
            {result.reset && <span>{copy.changed}</span>}
          </>
        )}
      </div>
      {pending && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-my-1 -mr-2 text-muted-foreground"
          disabled={disabled}
          onClick={onPause}
          aria-label={paused ? copy.resume : copy.pause}
          title={paused ? copy.resume : copy.pause}
        >
          {paused ? (
            <PlayIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <PauseIcon aria-hidden="true" className="size-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
