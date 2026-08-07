import { CheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react';
import type { AssistantActivityEventDto, Locale } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';

interface Props {
  events: readonly AssistantActivityEventDto[];
  locale: Locale;
  running: boolean;
}

const labels = {
  en: {
    CREATION_SAVED: 'Creation and input saved',
    MODEL_REQUESTED: 'Sent to model',
    MODEL_RESPONDING: 'Response received',
    RESULT_VALIDATED: 'Directions validated',
    COMPLETED: 'Saved to creation',
    FAILED: 'Stopped with an error',
    INTERRUPTED: 'Interrupted',
  },
  zh: {
    CREATION_SAVED: '已保存创作与输入',
    MODEL_REQUESTED: '已提交模型',
    MODEL_RESPONDING: '已收到模型响应',
    RESULT_VALIDATED: '方向已校验',
    COMPLETED: '已归入新创作',
    FAILED: '执行失败',
    INTERRUPTED: '已中断',
  },
} as const;

export function AssistantProgressTimeline({ events, locale, running }: Props) {
  if (events.length === 0) return null;
  const ordered = [...events]
    .filter((event, index, values) => values.findIndex((candidate) => candidate.id === event.id) === index)
    .sort((left, right) => left.sequence - right.sequence);
  const last = ordered.at(-1);
  return (
    <ol data-assistant-progress className="mb-4 grid gap-1.5 rounded-lg border bg-background px-3 py-2.5">
      {ordered.map((event) => {
        const terminalError = event.phase === 'FAILED' || event.phase === 'INTERRUPTED';
        const active = running && event.id === last?.id && !terminalError;
        return (
          <li
            key={event.id}
            className={cn(
              'grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 text-2xs text-muted-foreground',
              event.phase === 'COMPLETED' && 'text-success',
              terminalError && 'text-destructive',
            )}
          >
            {active ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : terminalError ? (
              <CircleIcon className="size-3.5 fill-current" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            <span>{labels[locale][event.phase]}</span>
            {event.phase === 'MODEL_REQUESTED' && event.modelKey ? (
              <span className="font-mono text-[10px] text-muted-foreground">{event.modelKey}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
