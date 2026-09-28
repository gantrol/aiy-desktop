import { useMemo, useState } from 'react';
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { PetalPanel, PetalSelect, PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import {
  CODEX_PETAL_CENTER_PROVIDER_ID,
  petalHubSettingsSchema,
  type PetalHubSettings,
  type PetalQuota,
  type PetalTimerAction,
} from '@/shared/contracts/petal-hub';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { formatPetalDuration, hasPetalTimerSession, petalTimerRemaining } from '@/shared/petal-timer';
const zones = Intl.supportedValuesOf('timeZone');
const automaticQuotaValue = '__automatic__';

export function PetalHubSettingsPanel({
  snapshot,
  now,
  quota,
}: {
  snapshot: DesktopPetalSnapshot;
  now: number;
  quota: PetalQuota | null;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals;
  const [settings, setSettings] = useState(snapshot.hubSettings),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(snapshot.hubSettings);
  const patch = (value: Partial<PetalHubSettings>) => setSettings((current) => ({ ...current, ...value }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const timer = (action: PetalTimerAction) => void run(() => window.desktopPetals.timerAction(action));
  const showTimerControls =
    settings.mode === 'pomodoro' || hasPetalTimerSession(snapshot.timer, snapshot.hubSettings, now);
  const modeOptions = useMemo(() => {
    const builtIn = [
      { value: 'none', label: copy.settings.modes.none },
      { value: 'clock', label: copy.settings.modes.clock },
      { value: 'pomodoro', label: copy.settings.modes.pomodoro },
    ];
    const contributed = (quota?.providers ?? []).map((provider) => ({
      value: provider.id,
      label: provider.id === CODEX_PETAL_CENTER_PROVIDER_ID ? copy.settings.modes.codex : provider.name,
    }));
    const options = [...builtIn, ...contributed];
    if (!options.some((option) => option.value === settings.mode))
      options.push({
        value: settings.mode,
        label: settings.mode === CODEX_PETAL_CENTER_PROVIDER_ID ? copy.settings.modes.codex : settings.mode,
      });
    return options;
  }, [copy.settings.modes, quota?.providers, settings.mode]);
  return (
    <PetalPanel title={copy.settings.title} onBack={() => void run(() => window.desktopPetals.hubView('flower'))}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <Input
          aria-label={copy.document.title}
          placeholder={copy.document.title}
          maxLength={200}
          value={settings.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
        <div className="space-y-1">
          <Label>{copy.settings.content}</Label>
          <PetalSelect
            label={copy.settings.content}
            value={settings.mode}
            options={modeOptions}
            onChange={(value) => patch({ mode: value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="flower-size">{copy.controls.size}</Label>
          <Input
            id="flower-size"
            type="number"
            min={128}
            max={184}
            step={8}
            value={settings.flowerSize}
            onChange={(event) => patch({ flowerSize: Number(event.target.value) })}
          />
        </div>
        {settings.mode === 'clock' && (
          <div className="space-y-1">
            <Label htmlFor="flower-zone">{copy.settings.region}</Label>
            <Input
              id="flower-zone"
              list="flower-zones"
              value={settings.timeZone}
              onChange={(event) => patch({ timeZone: event.target.value })}
            />
            <datalist id="flower-zones">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
        )}
        {settings.mode === 'pomodoro' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {(['focusMinutes', 'breakMinutes'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key}>{copy.settings[key]}</Label>
                  <Input
                    id={key}
                    type="number"
                    min={1}
                    max={key === 'focusMinutes' ? 180 : 60}
                    value={settings[key]}
                    onChange={(event) => patch({ [key]: Number(event.target.value) })}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="timer-notify"
                checked={settings.timerNotification}
                onCheckedChange={(value) => patch({ timerNotification: value === true })}
              />
              <Label htmlFor="timer-notify">{copy.controls.notify}</Label>
            </div>
          </>
        )}
        {showTimerControls && (
          <div className="flex items-center gap-2">
            <span className="mr-auto text-sm tabular-nums">
              {copy.timer[snapshot.timer.phase]} · {formatPetalDuration(petalTimerRemaining(snapshot.timer, now))}
            </span>
            <PetalIconButton
              label={snapshot.timer.endsAt === null ? copy.settings.start : copy.settings.pause}
              disabled={busy || dirty || petalTimerRemaining(snapshot.timer, now) === 0}
              onClick={() => timer(snapshot.timer.endsAt === null ? 'start' : 'pause')}
            >
              {snapshot.timer.endsAt === null ? <Play /> : <Pause />}
            </PetalIconButton>
            <PetalIconButton label={copy.controls.reset} disabled={busy || dirty} onClick={() => timer('reset')}>
              <RotateCcw />
            </PetalIconButton>
            <PetalIconButton label={copy.controls.next} disabled={busy || dirty} onClick={() => timer('next')}>
              <SkipForward />
            </PetalIconButton>
          </div>
        )}
        {settings.mode === CODEX_PETAL_CENTER_PROVIDER_ID && (
          <>
            <div className="space-y-1">
              <Label>{copy.settings.quotaWindow}</Label>
              <PetalSelect
                label={copy.settings.quotaWindow}
                value={settings.codexLimitId ?? automaticQuotaValue}
                options={[
                  { value: automaticQuotaValue, label: copy.settings.automatic },
                  ...(quota?.limits ?? []).map((limit) => ({
                    value: limit.id,
                    label: limit.name || copy.quota.defaultLimit,
                  })),
                ]}
                onChange={(value) => patch({ codexLimitId: value === automaticQuotaValue ? null : value })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void run(async () => {
                  await window.desktopPetals.codex.command({ kind: 'open-plugin' });
                })
              }
            >
              {copy.codex.plugin}
            </Button>
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="py-2 text-xs text-destructive">
          {petalErrorText(error, copy.errors)}
        </div>
      )}
      <Button
        className="mt-3 self-end"
        size="sm"
        disabled={busy || !dirty}
        onClick={() => void run(() => window.desktopPetals.configureHub(petalHubSettingsSchema.parse(settings)))}
      >
        {busy ? copy.note.saving : copy.settings.apply}
      </Button>
    </PetalPanel>
  );
}
