import { useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { calendarTimeZoneLabel } from '@/renderer/features/calendar/calendarTimeZones';
import { useCalendarSystemTimeZone } from '@/renderer/features/calendar/useCalendarSystemTimeZone';
import type { CalendarPreferences } from '@/shared/contracts/calendar';

export function CalendarTimeZoneChange({
  preferences,
  active,
  onChange,
}: {
  preferences: CalendarPreferences;
  active: boolean;
  onChange(patch: Partial<CalendarPreferences>): void;
}) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const previousFocus = useRef<HTMLElement | null>(null);
  const system = useCalendarSystemTimeZone(preferences, active, onChange);
  if (!system) return null;
  const keep = () => onChange({ lastSystemTimeZone: system });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) keep();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-lg rounded-md"
        onOpenAutoFocus={() => {
          previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault();
            previousFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">
            {preferences.lastSystemTimeZone ? m.systemTimeZoneChanged : m.systemTimeZoneDiffers}
          </DialogTitle>
        </DialogHeader>
        <dl className="grid gap-3 text-sm">
          <div className="grid gap-1">
            <dt className="text-xs text-muted-foreground">{m.calendarTimeZone}</dt>
            <dd>{calendarTimeZoneLabel(preferences.timeZone, m)}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs text-muted-foreground">{m.systemTimeZone}</dt>
            <dd>{calendarTimeZoneLabel(system, m)}</dd>
          </div>
        </dl>
        <DialogFooter>
          <Button variant="ghost" onClick={keep}>
            {m.keepTimeZone}
          </Button>
          <Button variant="outline" onClick={() => onChange({ timeZone: system, followSystemTimeZone: true })}>
            {m.followSystemTimeZone}
          </Button>
          <Button onClick={() => onChange({ timeZone: system, followSystemTimeZone: false })}>
            {m.changeTimeZone}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
