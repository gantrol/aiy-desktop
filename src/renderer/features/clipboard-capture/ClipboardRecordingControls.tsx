import { ChevronDown, Pause, Play } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';
import type { ClipboardStatus } from '@/shared/contracts/clipboard-capture';

function recordingState(status: ClipboardStatus | null) {
  if (!status) return 'loading';
  if (!status.supported) return 'unsupported';
  if (!status.enabled) return 'disabled';
  if (status.pause) return 'paused';
  if (!status.canRecord) return 'permissionRequired';
  if (status.recording) return 'active';
  if (status.starting) return 'starting';
  return status.error ? 'stopped' : 'paused';
}

export function ClipboardRecordingControls({
  controller,
  onOpenPermissions,
}: {
  controller: ClipboardHistoryController;
  onOpenPermissions?(): void;
}) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const { status, busy, run } = controller;
  const state = recordingState(status);
  const canResume = Boolean(status?.supported && status.canRecord);
  const pause = status?.pause;
  const pauseLabel =
    pause?.kind === 'timed'
      ? l.pausedUntil.replace(
          '{time}',
          new Date(pause.until).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        )
      : l.pausedUntilRestart;
  return (
    <>
      <span role="status" className="text-xs text-muted-foreground">
        {pause && state === 'paused' ? pauseLabel : state === 'unsupported' ? l.errors.unsupported : l[state]}
      </span>
      {pause && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canResume}
          onClick={() => void run({ kind: 'resumeRecording' })}
        >
          <Play />
          {l.resume}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy || !status?.enabled || !status.supported}>
            <Pause />
            {l.pause}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {([1, 5, 10] as const).map((minutes) => (
            <DropdownMenuItem key={minutes} onSelect={() => void run({ kind: 'pauseRecording', duration: minutes })}>
              {l.pauseMinutes.replace('{minutes}', minutes.toLocaleString(locale))}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => void run({ kind: 'pauseRecording', duration: 'untilRestart' })}>
            {l.pauseUntilRestart}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {state === 'stopped' && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canResume}
          onClick={() => void run({ kind: 'resumeRecording' })}
        >
          {l.retryRecording}
        </Button>
      )}
      {status?.enabled && !status.canRecord && onOpenPermissions && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onOpenPermissions}>
          {l.permissions}
        </Button>
      )}
    </>
  );
}
