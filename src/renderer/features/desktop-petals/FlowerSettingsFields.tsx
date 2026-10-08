import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { PetalIconButton, PetalSelect } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CODEX_PETAL_CENTER_PROVIDER_ID,
  type PetalHubSettings,
  type PetalQuota,
  type PetalTimer,
  type PetalTimerAction,
} from '@/shared/contracts/petal-hub';
import { formatPetalDuration, petalTimerRemaining } from '@/shared/petal-timer';

export type FlowerSettingsSave = (patch: Partial<PetalHubSettings>) => void;

function SettingInput({
  label,
  value,
  save,
  min,
  max,
  step,
  list,
}: {
  label: string;
  value: string | number;
  save(value: string): void;
  min?: number;
  max?: number;
  step?: number;
  list?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (input: HTMLInputElement) => {
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
    if (draft !== String(value)) save(draft);
  };
  return (
    <Label className="grid gap-1 text-xs">
      {label}
      <Input
        type={typeof value === 'number' ? 'number' : 'text'}
        className="h-8 text-xs"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        list={list}
        maxLength={typeof value === 'string' ? 200 : undefined}
        required={typeof value === 'number'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget);
          }
          if (event.key === 'Escape') setDraft(String(value));
        }}
      />
    </Label>
  );
}

export function FlowerDisplaySettings({
  settings,
  quota,
  save,
}: {
  settings: PetalHubSettings;
  quota: PetalQuota | null;
  save: FlowerSettingsSave;
}) {
  const copy = useI18n().messages.desktopPetals;
  const options = [
    { value: 'none', label: copy.settings.modes.none },
    { value: 'clock', label: copy.settings.modes.clock },
    { value: 'pomodoro', label: copy.settings.modes.pomodoro },
    ...(quota?.providers ?? []).map((provider) => ({
      value: provider.id,
      label: provider.id === CODEX_PETAL_CENTER_PROVIDER_ID ? copy.settings.modes.codex : provider.name,
    })),
  ];
  if (!options.some((option) => option.value === settings.mode))
    options.push({
      value: settings.mode,
      label: settings.mode === CODEX_PETAL_CENTER_PROVIDER_ID ? copy.settings.modes.codex : settings.mode,
    });
  return (
    <>
      <PetalSelect
        label={copy.settings.content}
        value={settings.mode}
        options={options}
        onChange={(mode) => save({ mode })}
      />
      {settings.mode === 'clock' && (
        <>
          <SettingInput
            label={copy.settings.region}
            value={settings.timeZone}
            list="flower-time-zones"
            save={(timeZone) => save({ timeZone })}
          />
          <datalist id="flower-time-zones">
            {Intl.supportedValuesOf('timeZone').map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </>
      )}
      {settings.mode === CODEX_PETAL_CENTER_PROVIDER_ID && (
        <PetalSelect
          label={copy.settings.quotaWindow}
          value={settings.codexLimitId ?? '__automatic__'}
          options={[
            { value: '__automatic__', label: copy.settings.automatic },
            ...(quota?.limits ?? []).map((limit) => ({
              value: limit.id,
              label: limit.name || copy.quota.defaultLimit,
            })),
          ]}
          onChange={(value) => save({ codexLimitId: value === '__automatic__' ? null : value })}
        />
      )}
    </>
  );
}

export function FlowerTimerSettings({
  settings,
  timer,
  now,
  save,
  act,
}: {
  settings: PetalHubSettings;
  timer: PetalTimer;
  now: number;
  save: FlowerSettingsSave;
  act(action: PetalTimerAction): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const remaining = petalTimerRemaining(timer, now);
  const paused = timer.endsAt === null;
  const label =
    remaining === 0
      ? timer.phase === 'focus'
        ? copy.timer.startBreak
        : copy.timer.startFocus
      : paused
        ? copy.settings.start
        : copy.settings.pause;
  return (
    <>
      <div className="flex items-center gap-1">
        <span className="mr-auto text-xs tabular-nums">
          {copy.timer[timer.phase]} · {formatPetalDuration(remaining)}
        </span>
        <PetalIconButton label={label} onClick={() => act(remaining === 0 ? 'next' : paused ? 'start' : 'pause')}>
          {paused ? <Play /> : <Pause />}
        </PetalIconButton>
        <PetalIconButton label={copy.controls.reset} onClick={() => act('reset')}>
          <RotateCcw />
        </PetalIconButton>
        <PetalIconButton label={copy.controls.next} onClick={() => act('next')}>
          <SkipForward />
        </PetalIconButton>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SettingInput
          label={copy.settings.focusMinutes}
          value={settings.focusMinutes}
          min={1}
          max={180}
          save={(value) => save({ focusMinutes: Number(value) })}
        />
        <SettingInput
          label={copy.settings.breakMinutes}
          value={settings.breakMinutes}
          min={1}
          max={60}
          save={(value) => save({ breakMinutes: Number(value) })}
        />
      </div>
      <Label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={settings.timerNotification}
          onCheckedChange={(checked) => save({ timerNotification: checked === true })}
        />
        {copy.controls.notify}
      </Label>
    </>
  );
}

export function FlowerAppearanceSettings({ settings, save }: { settings: PetalHubSettings; save: FlowerSettingsSave }) {
  const copy = useI18n().messages.desktopPetals;
  return (
    <>
      <SettingInput label={copy.document.title} value={settings.title} save={(title) => save({ title })} />
      <SettingInput
        label={copy.controls.size}
        value={settings.flowerSize}
        min={128}
        max={184}
        step={8}
        save={(value) => save({ flowerSize: Number(value) })}
      />
    </>
  );
}
