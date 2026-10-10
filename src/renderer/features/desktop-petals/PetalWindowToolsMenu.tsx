import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PetalWindowToolsCommand, PetalWindowToolsState } from '@/shared/contracts/petal-window-tools';

export function PetalWindowToolsMenu({ disabled, onError }: { disabled: boolean; onError(reason: unknown): void }) {
  const { messages, locale } = useI18n();
  const l = messages.desktopPetals.windowTools;
  const [state, setState] = useState<PetalWindowToolsState | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => {
    let current = true;
    void window.desktopPetals.windowTools({ kind: 'get' }).then(
      (value) => {
        if (current) setState(value);
      },
      (reason) => {
        if (current) error.current(reason);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const run = async (command: PetalWindowToolsCommand) => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    try {
      setState(await window.desktopPetals.windowTools(command));
    } catch (reason) {
      onError(reason);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (!state) return null;
  const blocked = disabled || busy;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{l.opacity}</DropdownMenuLabel>
      <div className="grid grid-cols-4 gap-1 px-1">
        {[0.25, 0.5, 0.75, 1].map((opacity) => (
          <DropdownMenuItem
            key={opacity}
            disabled={blocked}
            className="justify-center"
            aria-current={state.opacity === opacity}
            onSelect={(event) => {
              event.preventDefault();
              void run({ kind: 'set', opacity });
            }}
          >
            {opacity.toLocaleString(locale, { style: 'percent' })}
          </DropdownMenuItem>
        ))}
      </div>
      <DropdownMenuCheckboxItem
        checked={state.locked}
        disabled={blocked}
        onCheckedChange={(locked) => void run({ kind: 'set', locked })}
      >
        {l.locked}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={state.clickThrough}
        disabled={blocked}
        onCheckedChange={(clickThrough) => void run({ kind: 'set', clickThrough })}
      >
        {l.clickThrough}
      </DropdownMenuCheckboxItem>
      <DropdownMenuLabel>{l.nudge}</DropdownMenuLabel>
      <div className="grid grid-cols-4 gap-1 px-1">
        {(
          [
            [ArrowLeft, -1, 0, l.left],
            [ArrowUp, 0, -1, l.up],
            [ArrowDown, 0, 1, l.down],
            [ArrowRight, 1, 0, l.right],
          ] as const
        ).map(([Icon, x, y, label]) => (
          <DropdownMenuItem
            key={label}
            aria-label={label}
            title={label}
            disabled={blocked || state.locked}
            className="justify-center"
            onSelect={(event) => {
              event.preventDefault();
              void run({ kind: 'nudge', x, y });
            }}
          >
            <Icon />
          </DropdownMenuItem>
        ))}
      </div>
      {state.displays.length > 1 && <DropdownMenuLabel>{l.display}</DropdownMenuLabel>}
      {state.displays.length > 1 &&
        state.displays.map((display, index) => (
          <DropdownMenuItem
            key={display.id}
            disabled={blocked || state.locked || display.id === state.displayId}
            onSelect={() => void run({ kind: 'display', id: display.id })}
          >
            {display.label || l.displayNumber.replace('{number}', (index + 1).toLocaleString(locale))}
          </DropdownMenuItem>
        ))}
      <DropdownMenuItem disabled={blocked} onSelect={() => void run({ kind: 'recover' })}>
        {l.recover}
      </DropdownMenuItem>
    </>
  );
}
