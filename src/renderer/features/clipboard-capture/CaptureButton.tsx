import { useState } from 'react';
import {
  AppWindow,
  ChevronDown,
  History,
  Monitor,
  ScanLine,
  Scroll,
  SquareDashedMousePointer,
  Video,
  X,
} from 'lucide-react';
import { CaptureToolButton } from '@/renderer/features/clipboard-capture/CaptureToolButton';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

export function CaptureButton({ controller }: { controller: ClipboardHistoryController }) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const [capturing, setCapturing] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState<0 | 3 | 5 | 10>(0);
  const disabled = controller.busy || !controller.status?.canCapture || !controller.status.supported;
  const start = (
    seconds: 0 | 3 | 5 | 10,
    mode: 'region' | 'screen' | 'window' | 'control' | 'previous' | 'scroll' | 'record' = 'region',
  ) => {
    setDelaySeconds(seconds);
    setCapturing(true);
    void controller.run({ kind: 'capture', delaySeconds: seconds, mode }).finally(() => setCapturing(false));
  };
  return (
    <div className="flex items-center gap-1">
      <CaptureToolButton
        label={l.capture}
        shortcut={
          controller.status?.settings.captureShortcut?.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl') ||
          undefined
        }
        variant="default"
        disabled={disabled}
        onClick={() => start(0)}
      >
        <ScanLine />
      </CaptureToolButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="w-5"
            disabled={disabled}
            aria-label={l.captureMode}
            title={l.captureMode}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(
            [
              ['screen', Monitor],
              ['window', AppWindow],
              ['control', SquareDashedMousePointer],
              ['previous', History],
              ['scroll', Scroll],
              ['record', Video],
            ] as const
          ).map(([mode, Icon]) => (
            <DropdownMenuItem key={mode} onSelect={() => start(0, mode)}>
              <Icon />
              {l.selection[mode]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {([3, 5, 10] as const).map((seconds) => (
            <DropdownMenuItem key={seconds} onSelect={() => start(seconds)}>
              {l.delaySeconds.replace('{seconds}', seconds.toLocaleString(locale))}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {capturing && (
        <CaptureToolButton
          label={
            delaySeconds
              ? `${l.cancel} · ${l.delaySeconds.replace('{seconds}', delaySeconds.toLocaleString(locale))}`
              : l.cancel
          }
          onClick={() =>
            void window.desktopApi.clipboardCapture.execute({ kind: 'cancelCapture' }).catch(() => controller.refresh())
          }
        >
          <X />
        </CaptureToolButton>
      )}
    </div>
  );
}
