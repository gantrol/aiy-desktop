import {
  Eye,
  EyeOff,
  House,
  Pin,
  Play,
  Pause,
  RotateCcw,
  Settings,
  StickyNote,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import {
  petalMenuItemClass,
  petalMenuSurfaceClass,
  petalMenuSeparatorClass,
} from '@/renderer/features/desktop-petals/petal-menu-style';
import { cn } from '@/renderer/lib/utils';
import { usePetalMenuApi, type PetalMenuControl } from '@/renderer/features/desktop-petals/petal-menu-api';
import { PetalCleanupMenu } from '@/renderer/features/desktop-petals/PetalCleanupMenu';
import { PetalSpaceLabel } from '@/renderer/features/desktop-petals/PetalSpaceLabel';
import { useI18n } from '@/renderer/i18n/useI18n';
import { hasPetalTimerSession, petalTimerRemaining } from '@/shared/petal-timer';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';

function PetalMenuItem({ icon: Icon, label, onSelect }: { icon: LucideIcon; label: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem
      className={petalMenuItemClass}
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Icon />
      {label}
    </DropdownMenuItem>
  );
}

export function PetalHubMenu({
  snapshot,
  onError,
  menu,
}: {
  snapshot: DesktopPetalSnapshot;
  onError: (error: unknown) => void;
  menu: PetalMenuControl;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const enabled = snapshot.hubView === 'flower';
  const api = usePetalMenuApi();
  const undo = snapshot.collectionUndo;
  const complete = petalTimerRemaining(snapshot.timer, Date.now()) === 0;
  const paused = snapshot.timer.endsAt === null;
  const showTimer =
    snapshot.hubSettings.mode === 'pomodoro' || hasPetalTimerSession(snapshot.timer, snapshot.hubSettings, Date.now());
  const timerLabel = complete
    ? snapshot.timer.phase === 'focus'
      ? copy.timer.startBreak
      : copy.timer.startFocus
    : paused
      ? copy.settings.start
      : copy.settings.pause;
  return (
    <DropdownMenu
      open={enabled && menu.anchor !== null}
      onOpenChange={(open) => {
        if (!open) menu.dismiss();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none fixed size-px border-0 p-0 opacity-0"
          style={{ left: menu.anchor?.x ?? 0, top: menu.anchor?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        collisionPadding={8}
        className={cn(
          petalMenuSurfaceClass,
          'max-h-[var(--radix-dropdown-menu-content-available-height)] w-56 max-w-[calc(100vw-16px)] overflow-y-auto',
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menu.restoreFocus();
        }}
      >
        <PetalSpaceLabel name={snapshot.libraryName} />
        <DropdownMenuSeparator className={petalMenuSeparatorClass} />
        {undo && (
          <>
            <PetalMenuItem
              icon={Undo2}
              label={copy.actions.undoCollection}
              onSelect={() => menu.select(api.undoCollection, undo.token)}
            />
            <DropdownMenuSeparator className={petalMenuSeparatorClass} />
          </>
        )}
        <PetalMenuItem
          icon={StickyNote}
          label={copy.actions.myPetals}
          onSelect={() => menu.select(api.hubView, 'notes')}
        />
        <PetalMenuItem icon={Pin} label={copy.board.pin} onSelect={() => menu.select(api.hubView, 'sources')} />
        {showTimer && (
          <>
            <DropdownMenuSeparator className={petalMenuSeparatorClass} />
            <PetalMenuItem
              icon={complete || paused ? Play : Pause}
              label={timerLabel}
              onSelect={() => menu.select(api.timerAction, complete ? 'next' : paused ? 'start' : 'pause')}
            />
            <PetalMenuItem
              icon={RotateCcw}
              label={copy.timer.resetPeriod}
              onSelect={() => menu.select(api.timerAction, 'reset')}
            />
          </>
        )}
        <DropdownMenuSeparator className={petalMenuSeparatorClass} />
        <PetalMenuItem icon={Eye} label={copy.actions.showAll} onSelect={() => menu.select(api.showAll)} />
        <PetalMenuItem icon={EyeOff} label={copy.actions.hideAll} onSelect={() => menu.select(api.hidePetals)} />
        <PetalMenuItem
          icon={snapshot.titlesVisible ? EyeOff : Eye}
          label={snapshot.titlesVisible ? copy.drawer.hideTitles : copy.drawer.showTitles}
          onSelect={() => menu.select(api.drawer, { kind: 'toggle-titles' })}
        />
        <PetalCleanupMenu disabled={snapshot.suspended} close={menu.close} onError={onError} />
        <DropdownMenuSeparator className={petalMenuSeparatorClass} />
        <PetalMenuItem
          icon={Settings}
          label={copy.menu.settings}
          onSelect={() => menu.select(api.hubView, 'settings')}
        />
        <PetalMenuItem icon={House} label={copy.menu.openMain} onSelect={() => menu.select(api.openMain)} />
        <PetalMenuItem icon={EyeOff} label={copy.menu.hideHub} onSelect={() => menu.select(api.hide)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
