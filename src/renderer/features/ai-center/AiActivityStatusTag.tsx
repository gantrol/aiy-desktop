import { CircleAlertIcon, CircleCheckIcon, Clock3Icon, LoaderCircleIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { activityStatus, type AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';

function presentation(status: string) {
  if (status === 'RUNNING' || status === 'QUEUED') {
    return { className: 'text-info', icon: <LoaderCircleIcon className="animate-spin" /> };
  }
  if (status === 'EXPIRED') {
    return { className: 'text-muted-foreground', icon: <Clock3Icon /> };
  }
  if (['FAILED', 'INTERRUPTED', 'PARTIAL'].includes(status)) {
    return { className: status === 'FAILED' ? 'text-destructive' : 'text-warning', icon: <CircleAlertIcon /> };
  }
  return { className: 'text-success', icon: <CircleCheckIcon /> };
}

export function AiActivityStatusTag({ record }: { record: AiActivityRecord }) {
  const l = useI18n().messages.aiCenter;
  const status = activityStatus(record);
  const state = presentation(status);
  return (
    <span
      data-ai-activity-status={status}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 text-2xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
        state.className,
      )}
    >
      <span aria-hidden="true" className="inline-flex">
        {state.icon}
      </span>
      <span>{l.statuses[status as keyof typeof l.statuses] ?? status}</span>
    </span>
  );
}
