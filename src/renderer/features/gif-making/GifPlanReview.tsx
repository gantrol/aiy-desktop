import { useState } from 'react';
import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { gifPlanSequence } from '@/shared/contracts/gif-motion-plan';
import type { GifGenerationModel } from '@/renderer/features/gif-making/useGifGeneration';
import { useI18n } from '@/renderer/i18n/useI18n';

export function GifPlanReview({
  motion,
  disabled,
  selectedIndex,
  onSelectedIndexChange,
}: {
  motion: GifGenerationModel;
  disabled: boolean;
  selectedIndex?: number;
  onSelectedIndexChange?(index: number): void;
}) {
  const labels = useI18n().messages.creator.gifMaker.generation;
  const [localSelected, setLocalSelected] = useState(0);
  const selected = selectedIndex ?? localSelected;
  const setSelected = onSelectedIndexChange ?? setLocalSelected;
  const plan = motion.plan;
  if (!plan) return null;
  const index = Math.min(selected, plan.states.length - 1);
  const change = (patch: Partial<typeof plan>) => motion.setPlan({ ...plan, ...patch });
  return (
    <section data-gif-plan-review className="space-y-3 border-t pt-4" aria-label={labels.planTitle}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{labels.planTitle}</h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !motion.source || !motion.prompt.trim() || (motion.mode === 'REGION' && !motion.region)}
          onClick={() => void motion.propose()}
        >
          {labels.replan}
        </Button>
      </div>
      <div className="flex gap-1 overflow-x-auto" role="group" aria-label={labels.storyboard}>
        {plan.states.map((state, i) => (
          <Button
            key={i}
            data-gif-plan-state-index={i}
            variant={index === i ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="shrink-0 tabular-nums"
            aria-label={`${labels.state} ${i + 1}`}
            aria-pressed={index === i}
            aria-invalid={!state.trim()}
            onClick={() => setSelected(i)}
          >
            {i + 1}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={labels.addState}
          disabled={plan.states.length >= 8}
          onClick={() => {
            change({ states: [...plan.states, ''] });
            setSelected(plan.states.length);
          }}
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        {labels.state} {index + 1}
        {index === 0 ? ` · ${labels.source}` : ''}
        <Textarea
          className="min-h-32 resize-y text-foreground"
          aria-label={`${labels.state} ${index + 1}`}
          data-control="gif-plan-state-text"
          value={plan.states[index]}
          readOnly={index === 0}
          maxLength={400}
          onChange={(event) =>
            change({ states: plan.states.map((state, i) => (index === i ? event.target.value : state)) })
          }
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          data-gif-plan-playback
          className="text-xs tabular-nums text-muted-foreground"
          aria-label={labels.returnMode}
        >
          {gifPlanSequence(plan)
            .map((state) => state + 1)
            .join(' → ')}
          {plan.returnMode !== 'ONE_WAY' && ' → 1 ↻'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={index === 0 || plan.states.length <= 4}
          onClick={() => {
            change({ states: plan.states.filter((_, i) => i !== index) });
            setSelected(Math.max(0, index - 1));
          }}
        >
          <XIcon className="size-3" />
          {labels.removeState}
        </Button>
      </div>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group px-0">
            <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
            {labels.planDetails}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <label className="block space-y-1 text-xs text-muted-foreground">
            {labels.planName}
            <Input value={plan.title} maxLength={120} onChange={(event) => change({ title: event.target.value })} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            {labels.subject}
            <Textarea
              value={plan.subject}
              maxLength={300}
              onChange={(event) => change({ subject: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            {labels.preserve}
            <Textarea
              value={plan.preserve}
              maxLength={600}
              onChange={(event) => change({ preserve: event.target.value })}
            />
          </label>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
