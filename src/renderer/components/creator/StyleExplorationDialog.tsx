import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClockIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PlayIcon,
  SendIcon,
} from 'lucide-react';
import type {
  AssistantAssumptionDto,
  DirectionExperimentDelegationInput,
  DirectionProposalDto,
  ImageGenerationRouteDto,
  GenerationTargetInput,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';

export const STYLE_EXPLORATION_MAX_RUNS = 16;

interface StyleExplorationDialogProps {
  open: boolean;
  directions: DirectionProposalDto[];
  targets: GenerationTargetInput[];
  routes?: Array<Pick<ImageGenerationRouteDto, 'key' | 'name' | 'provider' | 'qualityMode'>>;
  commonConstraints?: string[];
  assumptions?: AssistantAssumptionDto[];
  objective?: string;
  canvasLabel?: string | null;
  remoteScope?: string[];
  busy?: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onConfirm(delegation: DirectionExperimentDelegationInput): void | Promise<void>;
}

const copyByLocale = {
  en: {
    title: 'Confirm direction experiment',
    description: 'Approve a limited Agent handoff before any image generation starts.',
    delegation: 'Limited delegation',
    objective: 'Objective',
    deadline: 'Deadline',
    noDeadline: 'No deadline',
    decisions: 'Decisions',
    acceptDecision: 'Use this interpretation',
    unresolved: (count: number) => `${count} unresolved`,
    boundary: 'No automatic favorite, adoption, album, dictionary, or publishing actions.',
    directions: 'Directions',
    fixed: 'Keep fixed',
    routes: 'Generation targets',
    maximum: 'Maximum runs',
    canvas: 'Canvas',
    canvasDefault: 'Current default',
    cost: 'Estimated cost',
    costUnknown: 'Unknown',
    remote: 'Sent remotely',
    remoteDefault: 'Direction prompts and generation settings',
    quality: 'quality',
    providerManagedQuality: 'provider-managed quality',
    cancel: 'Cancel',
    confirm: 'Delegate and start',
    starting: 'Starting',
    risk: 'Risk',
    variable: 'Only variable',
    frozenPrompt: 'Frozen direction prompt',
    runLimitExceeded: (count: number) =>
      `This brief would start ${count} runs. Reduce the selected directions or target counts to ${STYLE_EXPLORATION_MAX_RUNS} or fewer.`,
    run: (count: number) => `${count} ${count === 1 ? 'run' : 'runs'}`,
  },
  zh: {
    delegation: '有限委派',
    objective: '目标',
    deadline: '期限',
    noDeadline: '不设期限',
    decisions: '待决定',
    acceptDecision: '按此解释执行',
    unresolved: (count: number) => `${count} 项未确认`,
    boundary: '不会自动收藏、采用、加入图集、修改词典或发布。',
    title: '确认方向实验',
    description: '确认有限授权后才会开始生图。',
    directions: '实验方向',
    fixed: '共同保持项',
    routes: '生成目标',
    maximum: '最大运行数',
    canvas: '画布',
    canvasDefault: '当前默认',
    cost: '预计费用',
    costUnknown: '未知',
    remote: '远端发送范围',
    remoteDefault: '方向 Prompt 与生成设置',
    quality: '质量',
    providerManagedQuality: 'Codex 托管质量',
    cancel: '取消',
    confirm: '委派并启动',
    starting: '正在启动',
    risk: '风险',
    variable: '唯一变化轴',
    frozenPrompt: '冻结的方向 Prompt',
    runLimitExceeded: (count: number) =>
      `此简报将启动 ${count} 次运行。请将所选方向或目标次数减少到 ${STYLE_EXPLORATION_MAX_RUNS} 次以内。`,
    run: (count: number) => `最多 ${count} 次运行`,
  },
} as const;

export function isStyleExplorationConfirmable(directionCount: number, maximumRuns: number, busy: boolean) {
  return directionCount > 0 && maximumRuns > 0 && maximumRuns <= STYLE_EXPLORATION_MAX_RUNS && !busy;
}

export function StyleExplorationDirectionBrief({
  direction,
  index,
}: {
  direction: DirectionProposalDto;
  index: number;
}) {
  const { locale } = useI18n();
  const copy = copyByLocale[locale];
  return (
    <article className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-surface-sunken font-mono text-2xs">
          {index + 1}
        </span>
        <strong className="text-sm">{direction.label}</strong>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{direction.rationale}</p>
      {direction.variableAxis && (
        <div className="mt-2 text-xs">
          <span className="text-2xs text-muted-foreground">{copy.variable}</span>
          <p className="mt-0.5 font-medium">{direction.variableAxis}</p>
        </div>
      )}
      {direction.risk && (
        <div className="mt-2 text-xs">
          <span className="text-2xs text-warning">{copy.risk}</span>
          <p className="mt-0.5 text-muted-foreground">{direction.risk}</p>
        </div>
      )}
      <details className="group mt-3 overflow-hidden rounded-md border bg-surface-sunken/35">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 text-xs font-medium outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
          />
          {copy.frozenPrompt}
        </summary>
        <div className="border-t p-2">
          <Textarea
            aria-label={`${copy.frozenPrompt}: ${direction.label}`}
            className="min-h-24 resize-y whitespace-pre-wrap font-mono text-xs leading-relaxed"
            readOnly
            rows={4}
            spellCheck={false}
            value={direction.prompt}
          />
        </div>
      </details>
    </article>
  );
}

export function StyleExplorationRunLimitNotice({ maximumRuns }: { maximumRuns: number }) {
  const { locale } = useI18n();
  const copy = copyByLocale[locale];
  if (maximumRuns <= STYLE_EXPLORATION_MAX_RUNS) return null;
  return (
    <div
      data-style-exploration-run-limit
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-surface px-3 py-2 text-xs text-destructive"
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{copy.runLimitExceeded(maximumRuns)}</span>
    </div>
  );
}

export function StyleExplorationDialog({
  open,
  directions,
  targets,
  routes = [],
  commonConstraints = [],
  assumptions = [],
  objective = '',
  canvasLabel = null,
  remoteScope = [],
  busy = false,
  error = '',
  onOpenChange,
  onConfirm,
}: StyleExplorationDialogProps) {
  const { locale } = useI18n();
  const copy = copyByLocale[locale];
  const assumptionKey = useMemo(() => JSON.stringify(assumptions), [assumptions]);
  const [acceptedDecisionIndexes, setAcceptedDecisionIndexes] = useState<number[]>([]);
  const [taskObjective, setTaskObjective] = useState(objective);
  const [deadlineLocal, setDeadlineLocal] = useState('');
  useEffect(() => {
    if (!open) return;
    setAcceptedDecisionIndexes([]);
    setTaskObjective(objective);
    setDeadlineLocal('');
  }, [open, objective, assumptionKey]);
  const runsPerDirection = targets.reduce((sum, target) => sum + Math.max(0, target.count), 0);
  const maximumRuns = directions.length * runsPerDirection;
  const decisionsResolved = acceptedDecisionIndexes.length === assumptions.length;
  const canConfirm =
    isStyleExplorationConfirmable(directions.length, maximumRuns, busy) &&
    decisionsResolved &&
    Boolean(taskObjective.trim());
  const exceedsRunLimit = maximumRuns > STYLE_EXPLORATION_MAX_RUNS;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy || next) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-2xl overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConicalIcon className="size-5 text-primary" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section
            data-direction-director-authorization
            className="rounded-lg border border-primary/25 bg-primary/5 p-3"
            aria-label={copy.delegation}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              <ClipboardCheckIcon className="size-3.5 text-primary" />
              {copy.delegation}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <label className="grid gap-1.5 text-xs">
                <span className="text-muted-foreground">{copy.objective}</span>
                <Input
                  value={taskObjective}
                  maxLength={2000}
                  onChange={(event) => setTaskObjective(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <CalendarClockIcon className="size-3" />
                  {copy.deadline}
                </span>
                <Input
                  type="datetime-local"
                  value={deadlineLocal}
                  onChange={(event) => setDeadlineLocal(event.target.value)}
                  placeholder={copy.noDeadline}
                />
              </label>
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">{copy.boundary}</p>
          </section>

          {assumptions.length > 0 && (
            <section data-direction-director-decisions aria-label={copy.decisions}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold">{copy.decisions}</h3>
                {!decisionsResolved && (
                  <span className="text-2xs font-medium text-warning">
                    {copy.unresolved(assumptions.length - acceptedDecisionIndexes.length)}
                  </span>
                )}
              </div>
              <div className="mt-2 grid gap-2">
                {assumptions.map((assumption, index) => {
                  const checked = acceptedDecisionIndexes.includes(index);
                  return (
                    <label
                      key={`${assumption.label}:${index}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-xs"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setAcceptedDecisionIndexes((current) =>
                            value === true
                              ? [...new Set([...current, index])]
                              : current.filter((item) => item !== index),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <strong className="block">{assumption.label}</strong>
                        <span className="mt-1 block text-foreground-secondary">{assumption.interpretation}</span>
                        {assumption.impact && (
                          <span className="mt-1 block text-muted-foreground">{assumption.impact}</span>
                        )}
                        <span className="mt-2 block font-medium text-primary">{copy.acceptDecision}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {commonConstraints.length > 0 && (
            <section aria-label={copy.fixed}>
              <h3 className="text-xs font-semibold">{copy.fixed}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {commonConstraints.map((constraint, index) => (
                  <span
                    key={`${constraint}:${index}`}
                    className="rounded-full border bg-surface-sunken px-2 py-1 text-xs"
                  >
                    {constraint}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section aria-label={copy.directions}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold">{copy.directions}</h3>
              <span className="font-mono text-2xs text-muted-foreground">{directions.length}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {directions.map((direction, index) => (
                <StyleExplorationDirectionBrief
                  key={`${direction.label}:${index}`}
                  direction={direction}
                  index={index}
                />
              ))}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border bg-surface-sunken/40 p-3" aria-label={copy.routes}>
              <h3 className="text-xs font-semibold">{copy.routes}</h3>
              <div className="mt-2 space-y-1.5">
                {targets.map((target, index) => {
                  const model = routes.find((item) => item.key === target.modelKey);
                  return (
                    <div
                      key={`${target.modelKey}:${index}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="min-w-0 truncate font-medium" title={model?.name ?? target.modelKey}>
                        {model?.name ?? target.modelKey}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        ×{target.count} ·{' '}
                        {model?.qualityMode === 'PROVIDER_MANAGED'
                          ? copy.providerManagedQuality
                          : `${target.quality} ${copy.quality}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border bg-surface-sunken/40 p-3 text-xs">
              <dt className="text-muted-foreground">{copy.maximum}</dt>
              <dd
                className={
                  exceedsRunLimit
                    ? 'text-right font-semibold tabular-nums text-destructive'
                    : 'text-right font-semibold tabular-nums'
                }
              >
                {copy.run(maximumRuns)}
              </dd>
              <dt className="text-muted-foreground">{copy.canvas}</dt>
              <dd className="truncate text-right font-medium" title={canvasLabel ?? copy.canvasDefault}>
                {canvasLabel ?? copy.canvasDefault}
              </dd>
              <dt className="text-muted-foreground">{copy.cost}</dt>
              <dd className="text-right font-medium text-warning">{copy.costUnknown}</dd>
            </dl>
          </div>

          <StyleExplorationRunLimitNotice maximumRuns={maximumRuns} />

          <section className="rounded-lg border border-warning/30 bg-warning-surface p-3" aria-label={copy.remote}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <SendIcon className="size-3.5" />
              {copy.remote}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-foreground-secondary">
              {(remoteScope.length > 0 ? remoteScope : [copy.remoteDefault]).map((item, index) => (
                <li key={`${item}:${index}`} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive-surface px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() =>
              void onConfirm({
                objective: taskObjective.trim(),
                deadlineAt: deadlineLocal ? new Date(deadlineLocal).toISOString() : null,
                remoteScope: remoteScope.length > 0 ? [...remoteScope] : [copy.remoteDefault],
                decisions: assumptions.map((assumption) => ({ ...assumption })),
              })
            }
          >
            {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
            {busy ? copy.starting : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { StyleExplorationDialogProps };
