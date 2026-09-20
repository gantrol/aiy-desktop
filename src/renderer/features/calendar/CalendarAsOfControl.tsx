import { useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { wallTimeCandidates, wallTimeInZone } from '@/renderer/features/calendar/calendarDates';

export function CalendarAsOfControl({
  knownAt,
  timeZone,
  disabled = false,
  onChange,
}: {
  knownAt?: string;
  timeZone: string;
  disabled?: boolean;
  onChange(value: string | undefined): void;
}) {
  const { messages, locale } = useI18n();
  const m = messages.calendar;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() =>
    wallTimeInZone(knownAt ?? new Date(Date.now() - 60_000).toISOString(), timeZone),
  );
  const [choice, setChoice] = useState('');
  const [error, setError] = useState(false);
  const candidates = open ? wallTimeCandidates(draft, timeZone) : [];
  const timestamp = knownAt
    ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(knownAt))
    : null;
  function changeOpen(value: boolean) {
    if (value) {
      setDraft(wallTimeInZone(knownAt ?? new Date(Date.now() - 60_000).toISOString(), timeZone));
      setChoice('');
      setError(false);
    }
    setOpen(value);
  }
  function apply() {
    const value = candidates.length === 1 ? candidates[0] : candidates.find((instant) => instant === choice);
    if (!value || Date.parse(value) > Date.now()) {
      setError(true);
      return;
    }
    setError(false);
    onChange(value);
    setOpen(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={knownAt ? 'secondary' : 'ghost'}
            size="sm"
            disabled={disabled}
            title={m.asOfHint}
            aria-label={timestamp ? `${m.asOfEnable} · ${timestamp}` : undefined}
          >
            <HistoryIcon className="size-3.5" />
            {timestamp ?? m.asOfEnable}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-80 max-w-[calc(100vw-2rem)] gap-3" aria-label={m.asOf}>
          <label className="grid min-w-0 gap-1.5 text-xs text-foreground-secondary">
            {m.asOf}
            <Input
              type="datetime-local"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setChoice('');
                setError(false);
              }}
            />
          </label>
          <span className="text-[11px] text-muted-foreground">{timeZone}</span>
          {candidates.length > 1 && (
            <Select
              value={choice}
              onValueChange={(value) => {
                setChoice(value);
                setError(false);
              }}
            >
              <SelectTrigger aria-label={m.timeOccurrence}>
                <SelectValue placeholder={m.timeOccurrence} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((value, index) => (
                  <SelectItem key={value} value={value}>
                    {index === 0 ? m.earlier : m.later} · {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {m.asOfInvalid}
            </p>
          )}
          <Button className="justify-self-end" size="sm" onClick={apply}>
            {m.asOfApply}
          </Button>
        </PopoverContent>
      </Popover>
      {knownAt && (
        <>
          <span role="status" className="text-xs text-warning">
            {m.asOfReadonly}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              onChange(undefined);
            }}
          >
            {m.asOfNow}
          </Button>
        </>
      )}
    </div>
  );
}
