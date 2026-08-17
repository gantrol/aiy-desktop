import { CheckCircle2Icon, CircleAlertIcon, Clock3Icon, LoaderCircleIcon, Settings2Icon } from 'lucide-react';
import { useId } from 'react';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { VideoDocumentToolbarAction } from '@/renderer/features/video-documents/VideoDocumentToolbar';
import {
  videoDocumentAutosaveDelayMsSchema,
  type VideoDocumentAutosavePreferences,
} from '@/renderer/features/video-documents/videoDocumentAutosavePreferences';
import { useI18n } from '@/renderer/i18n/useI18n';

export type VideoDocumentAutosaveStatus = 'off' | 'saved' | 'pending' | 'saving' | 'failed';

interface Props {
  preferences: VideoDocumentAutosavePreferences;
  status: VideoDocumentAutosaveStatus;
  onChange(preferences: VideoDocumentAutosavePreferences): void;
}

const DELAYS = [5_000, 15_000, 30_000, 60_000] as const;

export function VideoDocumentAutosaveSettings({ preferences, status, onChange }: Props) {
  const labels = useI18n().messages.videoDocuments.editor.autoSave;
  const enabledId = useId();
  const delayId = useId();
  const statusLabel = labels.status[status];
  const delayLabels = {
    5000: labels.delay.fiveSeconds,
    15000: labels.delay.fifteenSeconds,
    30000: labels.delay.thirtySeconds,
    60000: labels.delay.sixtySeconds,
  } as const;
  const icon =
    status === 'saving' ? (
      <LoaderCircleIcon className="size-4 animate-spin" />
    ) : status === 'failed' ? (
      <CircleAlertIcon className="size-4" />
    ) : status === 'saved' ? (
      <CheckCircle2Icon className="size-4" />
    ) : status === 'pending' ? (
      <Clock3Icon className="size-4" />
    ) : (
      <Settings2Icon className="size-4" />
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <VideoDocumentToolbarAction
          type="button"
          icon={icon}
          label={labels.settings}
          expanded={status === 'saving' || status === 'failed'}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id={enabledId}
            checked={preferences.enabled}
            onCheckedChange={(checked) => onChange({ ...preferences, enabled: checked === true })}
          />
          <Label htmlFor={enabledId}>{labels.enabled}</Label>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={delayId}>{labels.delay.label}</Label>
          <Select
            value={String(preferences.delayMs)}
            disabled={!preferences.enabled}
            onValueChange={(value) => {
              const parsed = videoDocumentAutosaveDelayMsSchema.safeParse(Number(value));
              if (parsed.success) onChange({ ...preferences, delayMs: parsed.data });
            }}
          >
            <SelectTrigger id={delayId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELAYS.map((delayMs) => (
                <SelectItem key={delayMs} value={String(delayMs)}>
                  {delayLabels[delayMs]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {statusLabel}
        </p>
      </PopoverContent>
    </Popover>
  );
}
