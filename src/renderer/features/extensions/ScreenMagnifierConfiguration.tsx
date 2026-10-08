import { useRef, useState } from 'react';
import { Flower2Icon } from 'lucide-react';
import type { ExtensionDto } from '@/shared/contracts';
import { petalError, petalErrorText } from '@/shared/petal-errors';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Open the host controls without replacing the user's usual flower display. */
export function ScreenMagnifierConfiguration({
  extension,
  disabled,
  notify,
}: {
  extension: ExtensionDto;
  disabled: boolean;
  notify(message: string): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const allowed =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);
  const open = async () => {
    if (pending.current || disabled || !allowed) return;
    pending.current = true;
    setOpening(true);
    try {
      const snapshot = await window.desktopPetals.snapshot();
      if (snapshot.magnifier?.availability === 'unsupported') throw petalError('magnifierUnsupported');
      if (snapshot.magnifier?.availability !== 'ready') throw petalError('magnifierDisabled');
      await window.desktopPetals.hubView('settings');
    } catch (error) {
      notify(petalErrorText(error, copy.errors));
    } finally {
      pending.current = false;
      setOpening(false);
    }
  };
  return (
    <section data-extension-plugin-settings>
      <Button disabled={disabled || !allowed || opening} aria-busy={opening} onClick={() => void open()}>
        <Flower2Icon className="size-4" />
        {copy.magnifier.useInFlower}
      </Button>
    </section>
  );
}
