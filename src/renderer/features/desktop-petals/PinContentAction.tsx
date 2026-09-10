import { useState } from 'react';
import { Pin } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContextMenuItem, ContextMenuIcon } from '@/renderer/components/ui/context-menu';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PinSource } from '@/shared/contracts/petal-board';
import { petalErrorText } from '@/shared/petal-errors';

interface Props {
  source: PinSource;
  disabled?: boolean;
  beforePin?(): Promise<boolean>;
  notify(message: string): void;
}
function usePinContent({ beforePin, notify }: Pick<Props, 'beforePin' | 'notify'>) {
  const copy = useI18n().messages.desktopPetals;
  const [busy, setBusy] = useState(false);
  const pin = async (source: PinSource) => {
    if (busy) return;
    setBusy(true);
    try {
      if (beforePin && !(await beforePin())) return;
      await window.desktopPetals.boardCommand({ kind: 'pin', source });
    } catch (reason) {
      notify(petalErrorText(reason, copy.errors));
    } finally {
      setBusy(false);
    }
  };
  return { busy, pin, label: copy.note.pin };
}
export function PinContentButton(props: Props & { iconOnly?: boolean }) {
  const { busy, pin, label } = usePinContent(props);
  return (
    <Button
      type="button"
      variant="ghost"
      size={props.iconOnly ? 'icon-sm' : 'sm'}
      disabled={props.disabled || busy}
      title={label}
      aria-label={label}
      onClick={() => void pin(props.source)}
    >
      <Pin className="size-3.5" />
      {!props.iconOnly && label}
    </Button>
  );
}
export function PinContentMenuItem(props: Props) {
  const { busy, pin, label } = usePinContent(props);
  return (
    <ContextMenuItem disabled={props.disabled || busy} onSelect={() => void pin(props.source)}>
      <ContextMenuIcon>
        <Pin />
      </ContextMenuIcon>
      {label}
    </ContextMenuItem>
  );
}

export function usePinContentAction(notify: Props['notify']) {
  const { busy, pin, label } = usePinContent({ notify });
  return (source: PinSource, disabled = false): ActionMenuAction => ({
    id: 'pin-to-desktop',
    label,
    icon: Pin,
    disabled: disabled || busy,
    onSelect: () => void pin(source),
  });
}
