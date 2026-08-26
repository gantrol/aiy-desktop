import { useState } from 'react';
import {
  CheckIcon,
  CirclePlayIcon,
  FileTextIcon,
  ImageIcon,
  ImagesIcon,
  LoaderCircleIcon,
  PresentationIcon,
  VideoIcon,
} from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { InspirationStashAction } from '@/renderer/components/creator/InspirationStashAction';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

export type CreationOutcomeKind = 'image' | 'social-post' | 'article' | 'presentation';
export type CreationOutcomePlan = { kind: 'image' } | { kind: 'social-post' } | { kind: 'article' };

interface Props {
  locale: Locale;
  value: CreationOutcomeKind[];
  onValueChange(value: CreationOutcomeKind[]): void;
  onChooseVideoDocument(): void;
}

interface PlannerProps {
  locale: Locale;
  stashReady: boolean;
  stashing: boolean;
  stashed: boolean;
  startReady: boolean;
  starting: boolean;
  onStashInspiration(): void;
  onStartCreation(plan: CreationOutcomePlan): void;
  onChooseVideoDocument(): void;
}

const outcomeIcons = {
  image: ImageIcon,
  'social-post': ImagesIcon,
  article: FileTextIcon,
  presentation: PresentationIcon,
} satisfies Record<CreationOutcomeKind, typeof ImageIcon>;

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function CreationOutcomePicker({ locale, value, onValueChange, onChooseVideoDocument }: Props) {
  const zh = locale === 'zh';
  const outcomes: Array<{ kind: CreationOutcomeKind; label: string; available: boolean }> = [
    { kind: 'image', label: zh ? '图片' : 'Image', available: true },
    { kind: 'social-post', label: zh ? '贴图' : 'Social post', available: true },
    { kind: 'article', label: zh ? '文章' : 'Article', available: true },
    { kind: 'presentation', label: zh ? '演示文稿' : 'Presentation', available: false },
  ];
  function toggleOutcome(kind: CreationOutcomeKind) {
    onValueChange(toggleValue(value, kind));
  }

  return (
    <section data-creation-outcomes className="mt-5 flex flex-col gap-3">
      <div className="flex h-7 items-center justify-between gap-3">
        <span className="text-sm font-semibold">{zh ? '这次要做' : 'Create'}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {zh ? `已选 ${value.length} 项` : `${value.length} selected`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {outcomes.map((outcome) => {
          const selectedIndex = value.indexOf(outcome.kind);
          const selected = selectedIndex >= 0;
          const Icon = outcomeIcons[outcome.kind];
          const roleLabel = selectedIndex === 0 ? (zh ? '主成果' : 'Primary') : zh ? '配套' : 'Companion';
          const availabilityLabel = outcome.available ? (zh ? '可用' : 'Available') : zh ? '待接入' : 'Planned';
          return (
            <Button
              key={outcome.kind}
              type="button"
              variant="outline"
              disabled={!outcome.available}
              aria-pressed={selected}
              title={!outcome.available ? (zh ? '待接入' : 'Planned') : undefined}
              className={cn(
                'h-auto min-h-16 justify-start gap-2.5 whitespace-normal px-3 py-2.5 text-left',
                selected && 'border-selected-border bg-selected text-selected-foreground hover:bg-selected',
              )}
              onClick={() => toggleOutcome(outcome.kind)}
            >
              <Icon className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="font-semibold">{outcome.label}</span>
                <span className="text-2xs font-normal text-muted-foreground">
                  {selected ? `${roleLabel} · ${availabilityLabel}` : availabilityLabel}
                </span>
              </span>
              {selected && <CheckIcon className="size-3.5" />}
            </Button>
          );
        })}
      </div>

      {value.includes('article') && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="w-12 shrink-0 text-xs font-medium text-foreground-secondary">{zh ? '流程' : 'Flow'}</span>
          <Button type="button" variant="outline" size="sm" onClick={onChooseVideoDocument}>
            <VideoIcon className="size-4" />
            {zh ? '视频转文章' : 'Video to article'}
          </Button>
        </div>
      )}
    </section>
  );
}

export function CreationOutcomePlanner({
  locale,
  stashReady,
  stashing,
  stashed,
  startReady,
  starting,
  onStashInspiration,
  onStartCreation,
  onChooseVideoDocument,
}: PlannerProps) {
  const [outcomes, setOutcomes] = useState<CreationOutcomeKind[]>([]);
  const unavailableOutcomes = outcomes.filter((outcome) => outcome === 'presentation');
  const selectedPlan: CreationOutcomePlan | null =
    outcomes.length !== 1
      ? null
      : outcomes[0] === 'image'
        ? { kind: 'image' }
        : outcomes[0] === 'social-post'
          ? { kind: 'social-post' }
          : outcomes[0] === 'article'
            ? { kind: 'article' }
            : null;
  const canStartCreation = startReady && Boolean(selectedPlan) && !starting && !stashing;
  const blockedTitle =
    outcomes.length === 0
      ? locale === 'zh'
        ? '请选择成果'
        : 'Choose a result'
      : unavailableOutcomes.length
        ? locale === 'zh'
          ? '所选成果尚未接入'
          : 'Some selected results are not available yet'
        : '';

  return (
    <>
      <CreationOutcomePicker
        locale={locale}
        value={outcomes}
        onValueChange={setOutcomes}
        onChooseVideoDocument={onChooseVideoDocument}
      />
      <div className="mt-4 flex min-h-10 items-center justify-end gap-2 border-t pt-4">
        <InspirationStashAction
          locale={locale}
          ready={stashReady}
          busy={stashing}
          saved={stashed}
          blocked={starting}
          onClick={onStashInspiration}
        />
        <Button
          data-action="start-creation"
          type="button"
          size="lg"
          disabled={!canStartCreation}
          title={blockedTitle}
          aria-busy={starting}
          onClick={() => selectedPlan && onStartCreation(selectedPlan)}
        >
          {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CirclePlayIcon className="size-4" />}
          {locale === 'zh' ? '开启创作' : 'Start creating'}
          {outcomes.length > 1 ? ` · ${outcomes.length}` : ''}
        </Button>
      </div>
    </>
  );
}
