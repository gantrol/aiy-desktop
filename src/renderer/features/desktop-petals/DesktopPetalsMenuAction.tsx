import { EyeOff, Flower2, List, Settings2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { petalErrorText } from '@/shared/petal-errors';
import { useI18n } from '@/renderer/i18n/useI18n';

const actions = [
  {
    id: 'show',
    icon: Flower2,
    run: () => window.desktopPetals.show(),
  },
  {
    id: 'notes',
    icon: List,
    run: () => window.desktopPetals.hubView('notes'),
  },
  {
    id: 'hide',
    icon: EyeOff,
    run: () => window.desktopPetals.hideAll(),
  },
  {
    id: 'settings',
    icon: Settings2,
    run: () => window.desktopPetals.hubView('settings'),
  },
] as const;

export function DesktopPetalsMenuAction({ onOpened }: { onOpened(): void }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-action="desktop-petals-menu">
        <Flower2 className="size-4" />
        <span>{copy.menu.title}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-60 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
          {actions.map(({ id, icon: Icon, run }) => (
            <Fragment key={id}>
              {id === 'settings' && <DropdownMenuSeparator />}
              <DropdownMenuItem
                data-action={`desktop-petals-${id}`}
                className="h-9 w-full justify-start gap-2 px-2 font-normal"
                disabled={busy}
                onSelect={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError('');
                  void Promise.resolve()
                    .then(run)
                    .then(onOpened)
                    .catch((reason) => setError(String(reason)))
                    .finally(() => setBusy(false));
                }}
              >
                <Icon className="size-4" />
                <span>
                  {id === 'show' ? copy.actions.showHub : id === 'notes' ? copy.actions.myPetals : copy.menu[id]}
                </span>
              </DropdownMenuItem>
            </Fragment>
          ))}
          {error && (
            <p className="px-2 text-xs text-destructive" role="alert">
              {petalErrorText(error, copy.errors)}
            </p>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
