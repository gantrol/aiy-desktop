import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ChevronDown, Clock3, Monitor, Scan, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { FlowerSettingPetal, foldFlowerSettingPetals } from '@/renderer/features/desktop-petals/FlowerSettingPetal';
import {
  FlowerAppearanceSettings,
  FlowerDisplaySettings,
  FlowerTimerSettings,
} from '@/renderer/features/desktop-petals/FlowerSettingsFields';
import { MagnifierSettings } from '@/renderer/features/desktop-petals/MagnifierSettings';
import { useFlowerViewport } from '@/renderer/features/desktop-petals/use-flower-viewport';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalError, petalErrorText } from '@/shared/petal-errors';
import { flowerSettingsLayout } from '@/shared/flower-settings-layout';
import { petalHubSettingsSchema, type PetalHubSettings, type PetalQuota } from '@/shared/contracts/petal-hub';
import { screenMagnifierRunning } from '@/shared/contracts/screen-magnifier';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

type Section = 'display' | 'timer' | 'magnifier' | 'appearance';
export interface FlowerSettingsHandle {
  close(): void;
}

export function PetalHubSettingsPanel({
  snapshot,
  now,
  quota,
  ref,
  onClosed,
}: {
  snapshot: DesktopPetalSnapshot;
  now: number;
  quota: PetalQuota | null;
  ref?: Ref<FlowerSettingsHandle>;
  onClosed(): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const running = screenMagnifierRunning(snapshot.magnifier);
  const [section, setSection] = useState<Section | null>(running ? 'magnifier' : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const petals = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLFieldSetElement>(null);
  const closeAfterSave = useRef(false);
  const live = useRef(true);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const viewport = useFlowerViewport(snapshot);
  const layout = flowerSettingsLayout(viewport, snapshot.hubSettings.flowerSize);
  const closePanel = async () => {
    closeAfterSave.current = false;
    await foldFlowerSettingPetals(petals.current);
    if (!live.current) return;
    try {
      await window.desktopPetals.hubView('flower');
      onClosed();
    } catch (reason) {
      // A failed close must leave the operation petals usable.
      petals.current?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      throw reason;
    }
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (closeAfterSave.current && live.current) await closePanel();
    } catch (reason) {
      if (live.current) setError(String(reason));
    } finally {
      pending.current = false;
      closeAfterSave.current = false;
      if (live.current) setBusy(false);
    }
  };
  const save = (patch: Partial<PetalHubSettings>) => {
    const libraryId = snapshot.libraryId;
    void run(async () => {
      // Merge with the latest saved settings, not a stale form-wide draft.
      const current = await window.desktopPetals.snapshot();
      if (!live.current || current.libraryId !== libraryId || latest.current.libraryId !== libraryId)
        throw petalError('libraryUnavailable');
      await window.desktopPetals.configureHub(petalHubSettingsSchema.parse({ ...current.hubSettings, ...patch }));
    });
  };
  const close = () => {
    const input = document.activeElement;
    if (input instanceof HTMLInputElement && fields.current?.contains(input)) {
      if (!input.reportValidity()) return;
      input.blur();
    }
    if (pending.current) {
      closeAfterSave.current = true;
      return;
    }
    void run(closePanel);
  };
  useImperativeHandle(ref, () => ({ close }));
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    // Clicking another application closes only the setting petals.
    const onBlur = () => {
      if (!document.querySelector('[data-state="open"][role="listbox"]')) closeRef.current();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);
  const start = () =>
    void run(async () => {
      await window.desktopPetals.magnifier('start');
      await closePanel();
    });
  const items = [
    { id: 'display' as const, label: copy.settings.petals.display, Icon: Monitor },
    { id: 'timer' as const, label: copy.settings.petals.timer, Icon: Clock3 },
    { id: 'magnifier' as const, label: copy.settings.petals.magnifier, Icon: Search },
    { id: 'appearance' as const, label: copy.settings.petals.appearance, Icon: Scan },
  ];
  const selectedLabel = items.find((item) => item.id === section)?.label;
  return (
    <>
      <div
        ref={petals}
        role="toolbar"
        aria-label={copy.settings.title}
        className="absolute grid items-start gap-y-1"
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
        }}
      >
        {items.map(({ id, label, Icon }, index) => {
          const column =
            layout.direction === 1 ? index % layout.columns : layout.columns - 1 - (index % layout.columns);
          const row = Math.floor(index / layout.columns);
          return (
            <div key={id} style={{ gridColumn: column + 1, gridRow: row + 1 }}>
              <FlowerSettingPetal
                label={label}
                icon={<Icon />}
                selected={section === id}
                disabled={busy}
                delay={index * 25}
                travel={{
                  x: viewport.x - layout.x - ((column + 0.5) * layout.width) / layout.columns,
                  y: viewport.y - layout.y - row * 100 - 40,
                }}
                onClick={() => {
                  setSection(section === id ? null : id);
                  if (id === 'magnifier' && !running && snapshot.magnifier?.availability === 'ready') start();
                }}
              />
            </div>
          );
        })}
      </div>
      <PetalIconButton
        label={copy.settings.petals.collapse}
        className="absolute bg-background/90"
        style={{ left: viewport.x - 14, top: viewport.y + snapshot.hubSettings.flowerSize / 2 + 4 }}
        onClick={close}
        disabled={busy}
      >
        <ChevronDown />
      </PetalIconButton>
      {(section || error) && (
        <div
          className="absolute overflow-y-auto rounded-sm bg-background p-2"
          style={{ left: layout.x, top: layout.controlsY, width: layout.width, maxHeight: layout.controlsHeight }}
        >
          <fieldset
            ref={fields}
            disabled={busy}
            aria-busy={busy}
            className="min-w-0 space-y-3 border-0 p-0 disabled:opacity-60"
          >
            {selectedLabel && (
              <legend className="mb-2 flex items-center gap-1 text-xs font-medium">
                <SlidersHorizontal className="size-3" />
                {selectedLabel}
              </legend>
            )}
            {section === 'display' && (
              <FlowerDisplaySettings settings={snapshot.hubSettings} quota={quota} save={save} />
            )}
            {section === 'timer' && (
              <FlowerTimerSettings
                settings={snapshot.hubSettings}
                timer={snapshot.timer}
                now={now}
                save={save}
                act={(action) => void run(() => window.desktopPetals.timerAction(action))}
              />
            )}
            {section === 'appearance' && <FlowerAppearanceSettings settings={snapshot.hubSettings} save={save} />}
            {section === 'magnifier' && (
              <>
                <MagnifierSettings
                  settings={snapshot.hubSettings.magnifier}
                  state={snapshot.magnifier}
                  onChange={(magnifier) => save({ magnifier })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || (!running && snapshot.magnifier?.availability !== 'ready')}
                  onClick={running ? () => void run(() => window.desktopPetals.magnifier('stop')) : start}
                >
                  {running ? copy.magnifier.stop : copy.magnifier.start}
                </Button>
              </>
            )}
          </fieldset>
          {error && (
            <div role="alert" className="mt-2 text-xs text-destructive">
              {petalErrorText(error, copy.errors)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
