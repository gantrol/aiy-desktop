import { useEffect, useRef } from 'react';
import { LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  error: string | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore(): void;
}

export function CodexHistoryAutoPager({ error, hasMore, loading, onLoadMore }: Props) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const targetRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !hasMore || loading || error || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, hasMore, loading]);

  if (!hasMore && !loading) return null;
  return (
    <div ref={targetRef} className="grid min-h-14 place-items-center border-t" aria-live="polite">
      {loading ? (
        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-label={l.actions.loadingMore} />
      ) : error ? (
        <Button type="button" variant="ghost" size="sm" onClick={onLoadMore}>
          <RotateCwIcon className="size-3.5" />
          {l.actions.retry}
        </Button>
      ) : null}
    </div>
  );
}
