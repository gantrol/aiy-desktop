import { ChevronDownIcon, FlaskConicalIcon } from 'lucide-react';
import type { DirectionExperimentDirectorTaskDto, GenerationTaskDto, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { generationPhaseLabel } from '@/renderer/components/generation/task-presentation';

interface Props {
  locale: Locale;
  task: DirectionExperimentDirectorTaskDto;
  generationTasks?: GenerationTaskDto[];
}

const statusCopy = {
  zh: {
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
  en: {
    DELEGATED: 'Delegated',
    PREPARING: 'Preparing',
    EXECUTING: 'Executing',
    WAITING_DECISION: 'Decision',
    PAUSED: 'Paused',
    WRAPPING_UP: 'Wrapping up',
    SUCCEEDED: 'Succeeded',
    PARTIAL_SUCCESS: 'Partial',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  },
} as const;

export function DirectionExperimentTaskCenterItem({ locale, task, generationTasks = [] }: Props) {
  const phaseLabels = useI18n().messages.app.generationStatus;
  return (
    <details data-agent-task={task.id} className="group border-b text-xs last:border-b-0">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-1.5 outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <FlaskConicalIcon className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{task.objective}</span>
        <span className="shrink-0 text-muted-foreground">{statusCopy[locale][task.status]}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-1 border-t bg-surface-sunken/30 px-3 py-2 text-2xs text-muted-foreground">
        <span>
          {locale === 'zh'
            ? `${task.authorization.directionCount} 个方向 · 最多 ${task.authorization.maximumRuns} 次运行 · 费用未知`
            : `${task.authorization.directionCount} directions · up to ${task.authorization.maximumRuns} runs · cost unknown`}
        </span>
        <span
          className="truncate"
          title={task.authorization.targets
            .map((target) => `${target.modelKey} ×${target.count} · ${target.quality}`)
            .join(' / ')}
        >
          {task.authorization.targets
            .map((target) => `${target.modelKey} ×${target.count} · ${target.quality}`)
            .join(' / ')}
        </span>
        <span className="truncate" title={task.authorization.remoteScope.join(' · ')}>
          {locale === 'zh' ? '远端发送' : 'Sent remotely'} · {task.authorization.remoteScope.join(' · ')}
        </span>
        <span>
          {locale === 'zh'
            ? `已完成 ${task.completedCount} / ${task.totalCount}`
            : `${task.completedCount} of ${task.totalCount} complete`}
        </span>
        {generationTasks.map((run) => (
          <span key={run.runId} className="flex items-center justify-between gap-2">
            <span className="truncate">{run.modelKey}</span>
            <span className="shrink-0">{generationPhaseLabel(run, phaseLabels)}</span>
          </span>
        ))}
        {task.authorization.decisions.map((decision, index) => (
          <span key={`${decision.label}:${index}`} className="truncate">
            {locale === 'zh' ? '决策' : 'Decision'} · {decision.label}: {decision.interpretation}
          </span>
        ))}
        {task.completionReport && (
          <span>
            {locale === 'zh'
              ? '未发生关系动作：收藏、采用、加入图集、修改词典、发布'
              : 'No relationship actions: favorite, adopt, add to album, update dictionary, publish'}
          </span>
        )}
      </div>
    </details>
  );
}

export type { Props as DirectionExperimentTaskCenterItemProps };
