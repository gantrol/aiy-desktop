import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarItem, CalendarQueryInput, CalendarQueryResult } from '@/shared/contracts/calendar';

export function useCalendarActivityDetails(spaceId: string, item: CalendarItem, query: CalendarQueryInput) {
  const objectType = item.activitySummary?.object.type;
  const objectId = item.activitySummary?.object.id;
  const eventId = item.id;
  const request = useMemo<CalendarQueryInput>(
    () => ({
      ...query,
      limit: 50,
      cursor: undefined,
      details:
        objectType && objectId
          ? { kind: 'object', object: { type: objectType, id: objectId } }
          : { kind: 'event', eventId },
    }),
    [query, objectType, objectId, eventId],
  );
  const [result, setResult] = useState<CalendarQueryResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    pending.current = true;
    setResult(null);
    setFailed(false);
    setLoading(true);
    void window.desktopApi.calendar
      .query(request, spaceId)
      .then(
        (value) => {
          if (generation.current === current) setResult(value);
        },
        () => {
          if (generation.current === current) setFailed(true);
        },
      )
      .finally(() => {
        if (generation.current === current) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [request, spaceId, reload]);

  async function loadMore() {
    if (pending.current || !result?.nextCursor) return;
    const current = generation.current;
    pending.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const next = await window.desktopApi.calendar.query({ ...request, cursor: result.nextCursor }, spaceId);
      if (generation.current === current) {
        setResult((previous) => previous && { ...next, items: [...previous.items, ...next.items] });
      }
    } catch (failure) {
      if (generation.current === current) {
        if (String(failure).includes('CALENDAR_CURSOR_STALE')) setReload((value) => value + 1);
        else setFailed(true);
      }
    } finally {
      if (generation.current === current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }

  return { result, failed, loading, loadMore, retry: () => setReload((value) => value + 1) };
}
