import { CalendarHistory } from '@/renderer/features/calendar/CalendarHistory';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRightIcon, PencilIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import { dateInTimeZone, formatCivilDate } from '@/renderer/features/calendar/calendarDates';
import {
  calendarItemTitle,
  calendarChangeLabels,
  calendarActivityContext,
  calendarActivityTime,
  calendarOperationLabel,
  formatCalendarTime,
} from '@/renderer/features/calendar/calendarPresentation';
import type { CalendarItem } from '@/shared/contracts/calendar';

function initialDisplayDate(item: CalendarItem, timeZone: string) {
  return item.when.kind === 'allDay' ? item.when.date : dateInTimeZone(item.when.startAt, timeZone);
}

function ActivityCorrectionButton({
  count,
  disabled,
  onStart,
  label,
}: {
  count: number;
  disabled: boolean;
  onStart(): void;
  label: string;
}) {
  if (count > 1) return null;
  return (
    <Button variant="outline" onClick={onStart} disabled={disabled}>
      <PencilIcon className="size-3.5" />
      {label}
    </Button>
  );
}

function CalendarItemFacts({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
      <dt className="text-muted-foreground">
        {item.timeBasis === 'recorded' ? m.recordedAt : item.timeBasis === 'observed' ? m.observedAt : m.declared}
      </dt>
      <dd>
        {item.activitySummary?.firstAt &&
          `${formatCivilDate(initialDisplayDate(item, timeZone), locale, { dateStyle: 'medium' })} · `}
        {item.activitySummary
          ? calendarActivityTime(item, locale, timeZone, m)
          : formatCalendarTime(item.when, locale, timeZone, m.allDay)}
      </dd>
      {!item.activitySummary && (
        <>
          {item.operation && (
            <>
              <dt className="text-muted-foreground">{m.change}</dt>
              <dd>{calendarOperationLabel(item.operation, m)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{m.originalRecordedAt}</dt>
          <dd>{timestamp(item.originalRecordedAt ?? item.recordedAt)}</dd>
          {item.updatedAt !== item.recordedAt && (
            <>
              <dt className="text-muted-foreground">{m.updatedAt}</dt>
              <dd>{timestamp(item.updatedAt)}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

interface Props {
  spaceId: string;
  item: CalendarItem;
  timeZone: string;
  knownAt?: string;
  canOpenSource: boolean;
  onOpenSource(): void;
  onClose(): void;
  onCorrected(item: CalendarItem): void;
}

export function CalendarItemDialog({
  spaceId,
  item,
  timeZone,
  knownAt,
  canOpenSource,
  onOpenSource,
  onClose,
  onCorrected,
}: Props) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');
  const [dateChanged, setDateChanged] = useState(item.when.kind === 'allDay');
  const [displayDate, setDisplayDate] = useState(() => initialDisplayDate(item, timeZone));
  const [invalidated, setInvalidated] = useState(item.invalidated);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function correct() {
    if (saving || item.historical || knownAt) return;
    if (!note.trim()) {
      setError(m.correctionRequired);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await window.desktopApi.calendar.correctActivity(
        {
          eventId: item.id,
          expectedRevision: item.revision,
          note: note.trim(),
          displayDate: dateChanged ? displayDate : null,
          invalidated,
        },
        spaceId,
      );
      if (alive.current) onCorrected(saved);
    } catch (failure) {
      if (alive.current) setError(/CONFLICT|REVISION|STALE/.test(String(failure)) ? m.conflict : m.saveFailed);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{calendarItemTitle(item, m)}</DialogTitle>
          <DialogDescription>
            {calendarActivityContext(item, m)}
            {item.corrected ? ` · ${m.corrected}` : ''}
            {item.invalidated ? ` · ${m.invalidated}` : ''}
          </DialogDescription>
        </DialogHeader>
        {item.historical && (
          <p className="rounded-lg bg-surface-sunken p-3 text-xs text-muted-foreground">{m.historicalSnapshot}</p>
        )}
        <CalendarItemFacts item={item} timeZone={timeZone} />
        {item.activityCount > 1 && item.changes.length > 0 && (
          <ul aria-label={m.change} className="grid gap-1 text-sm">
            {calendarChangeLabels(item, m).map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
        {item.note && (
          <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-sunken p-3 text-sm leading-relaxed">
            {item.note}
          </p>
        )}
        {item.thumbnailAssetId && (
          <div className="flex max-h-64 items-center justify-center overflow-hidden rounded-sm bg-muted">
            <AssetThumbnail
              asset={{ id: item.thumbnailAssetId }}
              size={512}
              alt={calendarItemTitle(item, m)}
              className="max-h-64 max-w-full object-contain"
              errorClassName="m-6 size-6"
            />
          </div>
        )}
        {item.packSync && item.packSync.packs.length > 0 && (
          <ul aria-label={m.packSyncDetails} className="divide-y divide-border text-sm">
            {item.packSync.packs.map((pack) => (
              <li key={pack.packId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate" title={pack.title}>
                  {pack.title || m.entityTypes.PACK} · {pack.version}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.packSyncStatuses[pack.status]}</span>
              </li>
            ))}
          </ul>
        )}
        {item.entity && !item.packSync && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {m.source} · {item.activitySummary ? calendarActivityContext(item, m) : m.categories[item.category]}
            </span>
            {canOpenSource ? (
              <Button variant="ghost" size="sm" onClick={onOpenSource}>
                {m.openSource}
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {item.entity.available ? m.sourceNotOpenable : m.sourceUnavailable}
              </span>
            )}
          </div>
        )}
        {correcting && (
          <div className="grid gap-3 border-t border-border pt-4">
            <p className="text-xs leading-relaxed text-muted-foreground">{m.correctionHint}</p>
            <label className="grid gap-1.5 text-xs text-foreground-secondary">
              {m.correctionNote}
              <Textarea autoFocus maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={dateChanged} onCheckedChange={(checked) => setDateChanged(checked === true)} />
              {m.changeDisplayDate}
            </label>
            {dateChanged && (
              <label className="grid gap-1.5 text-xs text-foreground-secondary">
                {m.date}
                <Input
                  type="date"
                  required
                  value={displayDate}
                  onChange={(event) => setDisplayDate(event.target.value)}
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={invalidated} onCheckedChange={(checked) => setInvalidated(checked === true)} />
              {m.invalidate}
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCorrecting(false)} disabled={saving}>
                {m.cancel}
              </Button>
              <Button size="sm" onClick={() => void correct()} disabled={saving}>
                {saving ? m.saving : m.save}
              </Button>
            </div>
          </div>
        )}
        {item.activityCount === 1 && (
          <CalendarHistory spaceId={spaceId} item={item} timeZone={timeZone} knownAt={knownAt} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {m.close}
          </Button>
          {!item.historical && !knownAt && (
            <ActivityCorrectionButton
              count={item.activityCount}
              disabled={correcting || saving}
              onStart={() => setCorrecting(true)}
              label={m.correction}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
