import { useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  Layers,
  Maximize2,
  MonitorDown,
  Palette,
  Pin,
  PinOff,
  Pencil,
  Save,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { NoteAppearancePicker } from '@/renderer/features/desktop-petals/NoteAppearancePicker';
import { PetalFileMenu } from '@/renderer/features/desktop-petals/PetalFileMenu';
import { PetalMenuContent, PetalMenuSection } from '@/renderer/features/desktop-petals/PetalMenu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { usePetalMenuApi, usePetalMenuExecutor } from '@/renderer/features/desktop-petals/petal-menu-api';
import type { DesktopNote, DesktopPetalSnapshot, PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';

export interface PetalNoteMenuActions {
  temporary?: boolean;
  promotionTarget?: string;
  onPromote?: () => Promise<unknown>;
  onConvert?: () => Promise<unknown>;
  onEditImage?: () => Promise<unknown>;
  onOpenFile?: () => Promise<unknown>;
  onCopyImage?: () => Promise<unknown>;
  onSaveAs?: () => Promise<unknown>;
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
  showWindowControls?: boolean;
  showAppearance?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  close: () => Promise<void>;
  trigger: ReactNode;
  align?: 'start' | 'end';
  onCloseAutoFocus?: (event: Event) => void;
  windowTools?: ReactNode;
}

/** Collapsed petals and expanded notes share commands, grouping and appearance controls. */
export function PetalNoteMenu({
  temporary,
  promotionTarget,
  onPromote,
  onConvert,
  onEditImage,
  onOpenFile,
  onCopyImage,
  onSaveAs,
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
  showAppearance = true,
  showWindowControls = true,
  onError,
  open,
  onOpenChange,
  close,
  trigger,
  align = 'end',
  onCloseAutoFocus,
  windowTools,
}: Props) {
  const { messages } = useI18n();
  const api = usePetalMenuApi();
  const execute = usePetalMenuExecutor();
  const copy = messages.desktopPetals;
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy;
  const run = async <Args extends unknown[]>(
    action: (...args: Args) => Promise<unknown>,
    args: Args,
    { dismiss = true, prepare = true }: { dismiss?: boolean; prepare?: boolean } = {},
  ) => {
    if (disabled || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (execute) return await execute(action, args, { dismiss, prepare });
      if (prepare && beforeAction && !(await beforeAction())) return;
      // Dismiss the command surface before expanding, hiding or changing placement.
      if (dismiss) await close();
      await action(...args);
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const item =
    <Args extends unknown[]>(action: (...args: Args) => Promise<unknown>, args: Args, prepare = true) =>
    (event: Event) => {
      event.preventDefault();
      void run(action, args, { prepare });
    };
  const layerItems = board.layers.map((layer) => {
    const selected = (board.memberships[note.id] ?? 'default') === layer.id;
    return (
      <DropdownMenuItem
        key={layer.id}
        role="menuitemradio"
        aria-checked={selected}
        disabled={blocked}
        onSelect={item(api.boardCommand, [{ kind: 'assign-layer', id: note.id, layerId: layer.id }])}
      >
        <Check className={selected ? '' : 'invisible'} />
        <span className="truncate">{layer.name || copy.board.defaultLayer}</span>
      </DropdownMenuItem>
    );
  });
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <PetalMenuContent align={align} onCloseAutoFocus={onCloseAutoFocus}>
        {onEditImage && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onEditImage, [])}>
            <Pencil />
            {copy.imageEditor.edit}
          </DropdownMenuItem>
        )}
        {onPromote && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onPromote, [])}>
            <Save />
            {copy.temporary.promote}
            {promotionTarget ? ` · ${promotionTarget}` : ''}
          </DropdownMenuItem>
        )}
        {onConvert && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onConvert, [])}>
            <Copy />
            {copy.temporary.convert}
          </DropdownMenuItem>
        )}
        {onExpand && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onExpand, [], false)}>
            <Maximize2 />
            {copy.actions.expand}
          </DropdownMenuItem>
        )}
        <PetalFileMenu
          temporary={temporary}
          persisted={persisted}
          disabled={blocked}
          onOpenFile={onOpenFile}
          onCopyImage={onCopyImage}
          onSaveAs={onSaveAs}
          select={(action) => item(action, [])}
        />
        {onDuplicate && !temporary && (
          <DropdownMenuItem disabled={blocked || !persisted} onSelect={item(onDuplicate, [])}>
            <Copy />
            {copy.actions.duplicate}
          </DropdownMenuItem>
        )}
        {onOpenTask && (
          <DropdownMenuItem disabled={blocked} onSelect={item(onOpenTask, [])}>
            <ExternalLink />
            {copy.codex.openTask}
          </DropdownMenuItem>
        )}
        {(showWindowControls || showAppearance || (persisted && board.layers.length > 1)) && <DropdownMenuSeparator />}
        {showWindowControls && (
          <DropdownMenuItem disabled={blocked} onSelect={item(api.setAlwaysOnTop, [!alwaysOnTop], false)}>
            {alwaysOnTop ? <PinOff /> : <Pin />}
            {alwaysOnTop ? copy.actions.pauseAlwaysOnTop : copy.actions.resumeAlwaysOnTop}
          </DropdownMenuItem>
        )}
        {showAppearance && (
          <PetalMenuSection icon={Palette} label={copy.actions.appearance} disabled={blocked}>
            <NoteAppearancePicker
              note={note}
              disabled={blocked}
              onChange={(patch) => void run(onAppearance, [patch], { dismiss: false, prepare: false })}
            />
          </PetalMenuSection>
        )}
        {persisted &&
          !temporary &&
          board.layers.length > 1 &&
          (showWindowControls ? (
            <PetalMenuSection icon={Layers} label={copy.actions.moveLayer} disabled={blocked}>
              {layerItems}
            </PetalMenuSection>
          ) : (
            <>
              <DropdownMenuLabel>{copy.actions.moveLayer}</DropdownMenuLabel>
              {layerItems}
            </>
          ))}
        {windowTools}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={blocked} onSelect={item(api.hide, [])}>
          <EyeOff />
          {copy.actions.hide}
        </DropdownMenuItem>
        {persisted && !temporary && (
          <DropdownMenuItem disabled={blocked} onSelect={item(api.remove, [])}>
            <MonitorDown />
            {copy.actions.remove}
          </DropdownMenuItem>
        )}
      </PetalMenuContent>
    </DropdownMenu>
  );
}
