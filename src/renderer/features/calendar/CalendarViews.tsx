import { useEffect, useRef, useState } from 'react';
import { BookmarkIcon, RefreshCwIcon, TrashIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { calendarSelectClass } from '@/renderer/features/calendar/calendarControls';
import type { CalendarPreferences } from '@/shared/contracts/calendar';
import type { CalendarView } from '@/shared/calendar-views';

interface Props {
  spaceId: string;
  preferences: CalendarPreferences;
  disabled: boolean;
  onApply(preferences: CalendarPreferences): void;
}

function preferencesKey(value: CalendarPreferences) {
  return JSON.stringify({
    ...value,
    categories: [...value.categories].sort(),
  });
}

export function CalendarViews({ spaceId, preferences, disabled, onApply }: Props) {
  const { messages } = useI18n();
  const m = messages.calendar;
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<CalendarView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const generation = useRef(0);
  const selected = views.find((view) => view.id === selectedId);
  const changed = selected && preferencesKey(selected.preferences) !== preferencesKey(preferences);

  useEffect(() => {
    if (!open) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    void window.desktopApi.calendar.listViews(spaceId).then(
      (next) => {
        if (request !== generation.current) return;
        setViews(next);
        setLoading(false);
      },
      () => {
        if (request !== generation.current) return;
        setError(m.viewsFailed);
        setLoading(false);
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [spaceId, open, refreshRevision, m.viewsFailed]);

  async function write(operation: 'new' | 'update' | 'delete') {
    if (saving || loading || (operation !== 'new' && !selected)) return;
    const request = generation.current;
    setSaving(true);
    setError('');
    try {
      if (operation === 'delete') {
        await window.desktopApi.calendar.deleteView(
          { id: selected!.id, expectedRevision: selected!.revision },
          spaceId,
        );
        if (request !== generation.current) return;
        setViews((current) => current.filter((view) => view.id !== selected!.id));
        setSelectedId('');
        setName('');
      } else {
        const next = await window.desktopApi.calendar.saveView(
          {
            ...(operation === 'update' ? { id: selected!.id, expectedRevision: selected!.revision } : {}),
            name,
            preferences,
          },
          spaceId,
        );
        if (request !== generation.current) return;
        setViews((current) =>
          [...current.filter((view) => view.id !== next.id), next].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSelectedId(next.id);
        setName(next.name);
      }
    } catch (failure) {
      if (request !== generation.current) return;
      const reason = String(failure);
      setError(
        reason.includes('REVISION_CONFLICT')
          ? m.viewConflict
          : reason.includes('NAME_EXISTS')
            ? m.viewNameExists
            : reason.includes('VIEW_LIMIT')
              ? m.viewLimit
              : m.viewSaveFailed,
      );
    } finally {
      if (request === generation.current) setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled}>
          <BookmarkIcon className="size-4" />
          {m.namedViews}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid max-h-[75dvh] w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto">
        <p className="text-xs leading-relaxed text-muted-foreground">{m.viewSnapshotHint}</p>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          {m.namedViews}
          <select
            className={calendarSelectClass}
            value={selected?.id ?? ''}
            disabled={loading || saving}
            onChange={(event) => {
              const view = views.find((value) => value.id === event.target.value);
              setSelectedId(view?.id ?? '');
              setName(view?.name ?? '');
            }}
          >
            <option value="">{views.length ? m.saveNewView : m.noSavedViews}</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        {changed && <p className="text-xs text-muted-foreground">{m.viewUnsavedChanges}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || loading || saving}
            onClick={() => {
              if (selected) {
                onApply(selected.preferences);
                setOpen(false);
              }
            }}
          >
            {m.applyView}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={m.refresh}
            disabled={saving || loading}
            onClick={() => setRefreshRevision((value) => value + 1)}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
        <label className="grid gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          {m.viewName}
          <Input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {loading && (
          <p role="status" className="text-xs text-muted-foreground">
            {m.loading}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!name.trim() || loading || saving || views.length >= 50}
            onClick={() => void write('new')}
          >
            {m.saveNewView}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || !name.trim() || loading || saving}
            onClick={() => void write('update')}
          >
            {m.updateView}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={m.deleteView}
            disabled={!selected || loading || saving}
            onClick={() => void write('delete')}
          >
            <TrashIcon className="size-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
