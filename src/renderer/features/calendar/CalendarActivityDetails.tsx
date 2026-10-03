import { ArticleRevisionHistoryDialog } from '@/renderer/components/creator/article-editor/ArticleRevisionHistoryDialog';
import { Button } from '@/renderer/components/ui/button';
import { CalendarHistory } from '@/renderer/features/calendar/CalendarHistory';
import { calendarChangeLabels } from '@/renderer/features/calendar/calendarPresentation';
import { useCalendarActivityDetails } from '@/renderer/features/calendar/useCalendarActivityDetails';
import { contentAuthorLabel } from '@/renderer/features/content-provenance/ContentWriteContext';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CalendarItem, CalendarQueryInput } from '@/shared/contracts/calendar';

function recordedTime(item: CalendarItem) {
  return item.changes[0]?.operation === 'CORRECT' ? item.updatedAt : item.recordedAt;
}

export function CalendarActivityDetails({
  spaceId,
  item,
  query,
}: {
  spaceId: string;
  item: CalendarItem;
  query: CalendarQueryInput;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const state = useCalendarActivityDetails(spaceId, item, query);
  const timestamp = new Intl.DateTimeFormat(locale, {
    timeZone: query.timeZone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
  return (
    <section className="min-w-0 border-t border-border pt-3" aria-label={m.changeDetails}>
      <h3 className="text-sm font-medium">{m.changeDetails}</h3>
      <ol className="mt-2 divide-y divide-border">
        {state.result?.items.map((entry) => (
          <li key={entry.occurrenceId} className="grid gap-1 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span>{calendarChangeLabels(entry, m).join(' · ')}</span>
              <time className="text-xs tabular-nums text-muted-foreground" dateTime={recordedTime(entry)}>
                {timestamp.format(new Date(recordedTime(entry)))}
              </time>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {entry.writers?.map((writer) => contentAuthorLabel(writer, messages.contentProvenance)).join(' · ')}
                {entry.invalidated ? ` · ${m.invalidated}` : ''}
              </span>
              {entry.contentRevision ? (
                <ArticleRevisionHistoryDialog
                  spaceId={spaceId}
                  articleId={entry.contentRevision.articleId}
                  currentRevisionId={entry.contentRevision.revisionId}
                  initialRevision={entry.contentRevision}
                  triggerLabel={m.viewContentChanges.replace('{number}', String(entry.contentRevision.revisionNo))}
                  zh={locale.startsWith('zh')}
                />
              ) : ['ARTICLE', 'ARTICLE_REVISION', 'INSPIRATION_STASH'].includes(entry.entity?.type ?? '') &&
                ['CREATE', 'UPDATE'].includes(entry.changes[0]?.operation ?? '') ? (
                <span className="text-xs text-muted-foreground">{m.contentRevisionUnavailable}</span>
              ) : null}
            </div>
            {entry.note && <p className="whitespace-pre-wrap break-words text-xs">{entry.note}</p>}
            {item.activityCount > 1 && entry.corrected && (
              <CalendarHistory spaceId={spaceId} item={entry} timeZone={query.timeZone} knownAt={query.knownAt} />
            )}
          </li>
        ))}
      </ol>
      {!state.result && state.loading && (
        <span role="status" className="text-xs">
          {m.loading}
        </span>
      )}
      {state.result?.items.length === 0 && <span className="text-xs text-muted-foreground">{m.noChangeDetails}</span>}
      {state.failed && (
        <div className="flex items-center justify-between gap-2">
          <span role="alert" className="text-xs text-destructive">
            {m.changeDetailsFailed}
          </span>
          <Button variant="ghost" size="sm" onClick={() => (state.result ? void state.loadMore() : state.retry())}>
            {messages.referenceOutline.history.retry}
          </Button>
        </div>
      )}
      {state.result?.hasMore && !state.failed && (
        <Button variant="ghost" size="sm" disabled={state.loading} onClick={() => void state.loadMore()}>
          {state.loading ? m.loading : m.loadMore}
        </Button>
      )}
    </section>
  );
}
