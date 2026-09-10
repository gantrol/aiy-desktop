import { useRef, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, EyeOff, Layers, Maximize2, Palette, Pin, PinOff } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { NoteAppearancePicker } from '@/renderer/features/desktop-petals/NoteAppearancePicker';
import { PetalMenuContent, PetalMenuSection } from '@/renderer/features/desktop-petals/PetalMenu';
import { noteAppearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopNote, DesktopPetalSnapshot, PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';

export interface PetalNoteMenuActions {
  home?: 'desktop' | 'drawer';
  alwaysOnTop: boolean;
  note: Pick<DesktopNote, 'id' | 'color' | 'icon'>;
  board: DesktopPetalSnapshot['board'];
  persisted: boolean;
  disabled?: boolean;
  beforeAction?: () => Promise<boolean>;
  onDuplicate?: () => Promise<unknown>;
  onOpenTask?: () => Promise<unknown>;
  onExpand?: () => Promise<void>;
  onAppearance: (patch: { color?: PetalColor; icon?: PetalIcon }) => Promise<void>;
  onError: (error: unknown) => void;
}

interface Props extends PetalNoteMenuActions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  close: () => Promise<void>;
  trigger: ReactNode;
  align?: 'start' | 'end';
  onCloseAutoFocus?: (event: Event) => void;
}

/** Collapsed petals and expanded notes share commands, grouping and appearance controls. */
export function PetalNoteMenu({
  alwaysOnTop,
  note,
  board,
  persisted,
  disabled = false,
  beforeAction,
  onDuplicate,
  onOpenTask,
  onExpand,
  onAppearance,
  onError,
  open,
  onOpenChange,
  close,
  trigger,
  align = 'end',
  onCloseAutoFocus,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy;
  const style = noteAppearanceStyle(note.color);
  const run = async (
    action: () => Promise<unknown>,
    { dismiss = true, prepare = true }: { dismiss?: boolean; prepare?: boolean } = {},
  ) => {
    if (disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (prepare && beforeAction && !(await beforeAction())) return;
      // Restore the small native window before expanding, hiding or changing its placement.
      if (dismiss) await close();
      await action();
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const item =
    (action: () => Promise<unknown>, prepare = true) =>
    (event: Event) => {
      event.preventDefault();
      void run(action, { prepare });
    };
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <PetalMenuContent align={align} style={style} onCloseAutoFocus={onCloseAutoFocus}>
        {onExpand && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onExpand, false)}>
            <Maximize2 />
            {copy.actions.expand}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={blocked || !persisted} onSelect={item(() => window.desktopPetals.openMain())}>
          <ExternalLink />
          {copy.actions.openSource}
        </DropdownMenuItem>
        {onDuplicate && (
          <DropdownMenuItem disabled={blocked || !persisted} onSelect={item(onDuplicate)}>
            <Copy />
            {copy.actions.duplicate}
          </DropdownMenuItem>
        )}
        {onOpenTask && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onOpenTask)}>
            <ExternalLink />
            {copy.codex.openTask}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={blocked}
          onSelect={item(() => window.desktopPetals.setAlwaysOnTop(!alwaysOnTop), false)}
        >
          {alwaysOnTop ? <PinOff /> : <Pin />}
          {alwaysOnTop ? copy.actions.pauseAlwaysOnTop : copy.actions.resumeAlwaysOnTop}
        </DropdownMenuItem>
        <PetalMenuSection icon={Palette} label={copy.actions.appearance} disabled={blocked}>
          <NoteAppearancePicker
            note={note}
            disabled={blocked}
            onChange={(patch) => void run(() => onAppearance(patch), { dismiss: false, prepare: false })}
          />
        </PetalMenuSection>
        {persisted && board.layers.length > 1 && (
          <PetalMenuSection icon={Layers} label={copy.actions.moveLayer} disabled={blocked}>
            {board.layers.map((layer) => {
              const selected = (board.memberships[note.id] ?? 'default') === layer.id;
              return (
                <DropdownMenuItem
                  key={layer.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={blocked}
                  onSelect={item(() =>
                    window.desktopPetals.boardCommand({ kind: 'assign-layer', id: note.id, layerId: layer.id }),
                  )}
                >
                  <Check className={selected ? '' : 'invisible'} />
                  <span className="truncate">{layer.name || copy.board.defaultLayer}</span>
                </DropdownMenuItem>
              );
            })}
          </PetalMenuSection>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={blocked} onSelect={item(() => window.desktopPetals.hide())}>
          <EyeOff />
          {copy.actions.hide}
        </DropdownMenuItem>
        {persisted && (
          <DropdownMenuItem disabled={blocked} onSelect={item(() => window.desktopPetals.remove())}>
            <PinOff />
            {copy.actions.remove}
          </DropdownMenuItem>
        )}
      </PetalMenuContent>
    </DropdownMenu>
  );
}
