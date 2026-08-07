import {
  ClipboardCheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleStopIcon,
  Clock3Icon,
  LoaderCircleIcon,
} from 'lucide-react';
import type {
  DirectionExperimentDirectorTaskDto,
  DirectionExperimentDirectorTaskStatus,
  Locale,
} from '@/shared/contracts';
import { StateTag } from '@/renderer/components/ui/state-tag';

interface Props {
  locale: Locale;
  task: DirectionExperimentDirectorTaskDto;
}

const copy = {
  zh: {
    title: '有限委派',
    authorized: (directions: number, runs: number) => `${directions} 个方向 · 最多 ${runs} 次运行`,
    completed: (done: number, total: number) => `产出 ${done} / ${total}`,
    failed: (count: number) => `失败 ${count}`,
    retries: (count: number) => `重试 ${count}`,
    cancelled: (count: number) => `取消 ${count}`,
    interrupted: (count: number) => `中断 ${count}`,
    deadline: (value: string) => `期限 ${value}`,
    noDeadline: '不设期限',
    costUnknown: '费用未知',
    decisions: (count: number) => `已确认 ${count} 项决策`,
    targets: '模型',
    remote: '远端发送',
    untouched: '未自动收藏、采用、加入图集、修改词典或发布',
    status: {
      DELEGATED: '已委派',
      PREPARING: '准备中',
      EXECUTING: '执行中',
      WAITING_DECISION: '等待决定',
      PAUSED: '已暂停',
      WRAPPING_UP: '收尾中',
      SUCCEEDED: '成功',
      PARTIAL_SUCCESS: '部分成功',
      FAILED: '失败',
      CANCELLED: '取消',
    },
  },
  en: {
    title: 'Limited delegation',
    authorized: (directions: number, runs: number) => `${directions} directions · up to ${runs} runs`,
    completed: (done: number, total: number) => `${done} of ${total} outputs`,
    failed: (count: number) => `${count} failed`,
    retries: (count: number) => `${count} retries`,
    cancelled: (count: number) => `${count} cancelled`,
    interrupted: (count: number) => `${count} interrupted`,
    deadline: (value: string) => `Deadline ${value}`,
    noDeadline: 'No deadline',
    costUnknown: 'Cost unknown',
    decisions: (count: number) => `${count} decisions approved`,
    targets: 'Targets',
    remote: 'Sent remotely',
    untouched: 'No automatic favorite, adoption, album, dictionary, or publishing actions',
    status: {
      DELEGATED: 'Delegated',
      PREPARING: 'Preparing',
      EXECUTING: 'Executing',
      WAITING_DECISION: 'Waiting for decision',
      PAUSED: 'Paused',
      WRAPPING_UP: 'Wrapping up',
      SUCCEEDED: 'Succeeded',
      PARTIAL_SUCCESS: 'Partially succeeded',
      FAILED: 'Failed',
      CANCELLED: 'Cancelled',
    },
  },
} as const;

function statusTone(
  status: DirectionExperimentDirectorTaskStatus,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PARTIAL_SUCCESS' || status === 'WAITING_DECISION' || status === 'PAUSED') return 'warning';
  if (status === 'PREPARING' || status === 'EXECUTING' || status === 'WRAPPING_UP') return 'info';
  return 'neutral';
}

function statusIcon(status: DirectionExperimentDirectorTaskStatus) {
  if (status === 'PREPARING' || status === 'EXECUTING' || status === 'WRAPPING_UP')
    return <LoaderCircleIcon className="animate-spin" />;
  if (status === 'SUCCEEDED') return <CircleCheckIcon />;
  if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') return <CircleAlertIcon />;
  if (status === 'CANCELLED') return <CircleStopIcon />;
  return <Clock3Icon />;
}

export function DirectionExperimentDirectorSummary({ locale, task }: Props) {
  const labels = copy[locale];
  const report = task.completionReport;
  const deadline = task.authorization.deadlineAt
    ? labels.deadline(
        new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(task.authorization.deadlineAt)),
      )
    : labels.noDeadline;
  return (
    <section
      data-direction-director-task={task.id}
      className="border-b bg-primary/5 px-4 py-3"
      aria-label={labels.title}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <ClipboardCheckIcon className="size-3.5 text-primary" />
          {labels.title}
        </span>
        <StateTag tone={statusTone(task.status)} icon={statusIcon(task.status)}>
          {labels.status[task.status]}
        </StateTag>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary" title={task.objective}>
          {task.objective}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>{labels.authorized(task.authorization.directionCount, task.authorization.maximumRuns)}</span>
        <span>
          {labels.targets} ·{' '}
          {task.authorization.targets
            .map((target) => `${target.modelKey} ×${target.count} · ${target.quality}`)
            .join(' / ')}
        </span>
        <span>{deadline}</span>
        <span className="text-warning">{labels.costUnknown}</span>
        {task.authorization.decisions.length > 0 && (
          <span>{labels.decisions(task.authorization.decisions.length)}</span>
        )}
        <span className="basis-full truncate" title={task.authorization.remoteScope.join(' · ')}>
          {labels.remote} · {task.authorization.remoteScope.join(' · ')}
        </span>
      </div>
      {report && (
        <div
          data-direction-director-report
          className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-primary/15 pt-2 text-2xs"
        >
          <span className="font-medium">{labels.completed(report.outputCount, task.totalCount)}</span>
          {report.failedCount > 0 && <span className="text-destructive">{labels.failed(report.failedCount)}</span>}
          {report.retryRunCount > 0 && <span>{labels.retries(report.retryRunCount)}</span>}
          {report.cancelledCount > 0 && <span>{labels.cancelled(report.cancelledCount)}</span>}
          {report.interruptedCount > 0 && (
            <span className="text-warning">{labels.interrupted(report.interruptedCount)}</span>
          )}
          <span className="basis-full text-muted-foreground">{labels.untouched}</span>
        </div>
      )}
    </section>
  );
}

export type { Props as DirectionExperimentDirectorSummaryProps };
