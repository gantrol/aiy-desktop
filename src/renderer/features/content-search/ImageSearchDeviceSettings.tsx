import { useId } from 'react';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  imageSearchDeviceSchema,
  type ImageSearchDevice,
  type ImageSearchModelState,
} from '@/shared/contracts/image-search';

export function ImageSearchDeviceSettings({
  state,
  disabled,
  onChange,
}: {
  state: ImageSearchModelState;
  disabled: boolean;
  onChange(device: ImageSearchDevice): void;
}) {
  const copy = useI18n().messages.imageSearch;
  const deviceId = useId();
  const execution = (role: 'search' | 'index' | 'content' | 'video') => {
    const current = state.execution[role];
    if (!current.backend) return copy.notRunning;
    return current.fallback ? copy.cpuFallback : current.backend === 'webgpu' ? copy.webgpu : copy.cpu;
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor={deviceId}>{copy.device}</Label>
      <Select
        value={state.device}
        disabled={disabled}
        onValueChange={(value) => onChange(imageSearchDeviceSchema.parse(value))}
      >
        <SelectTrigger id={deviceId} aria-label={copy.device}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AUTO">{copy.automatic}</SelectItem>
          <SelectItem value="CPU">{copy.cpu}</SelectItem>
          <SelectItem value="GPU">{copy.gpu}</SelectItem>
        </SelectContent>
      </Select>
      <div role="status" className="grid gap-1 text-xs text-muted-foreground">
        <span>{copy.queryDevice(execution('search'))}</span>
        <span>{copy.indexDevice(execution('index'))}</span>
        <span>{copy.contentDevice(execution('content'))}</span>
        <span>{copy.videoDevice(execution('video'))}</span>
      </div>
    </div>
  );
}
