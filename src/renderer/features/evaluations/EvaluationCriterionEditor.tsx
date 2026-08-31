import { Trash2Icon } from 'lucide-react';
import type { EvaluationCriterion, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { lifecyclePhaseLabel } from '@/renderer/features/evaluations/evaluation-task-library';
import type { EvaluationCriterionPhase } from '@/shared/contracts/evaluation-suite';

interface Props {
  criterion: EvaluationCriterion;
  locale: Locale;
  onChange(criterion: EvaluationCriterion): void;
  onRemove(): void;
}

const criterionPhases: readonly EvaluationCriterionPhase[] = [
  'GENERAL',
  'IDEATION',
  'DESIGN',
  'DEVELOPMENT',
  'ITERATION',
];

export function EvaluationCriterionEditor({ criterion, locale, onChange, onRemove }: Props) {
  const labels =
    locale === 'zh'
      ? { phase: '阶段', label: '名称', description: '标准说明', weight: '权重', gate: '门槛', delete: '删除' }
      : {
          phase: 'Phase',
          label: 'Label',
          description: 'Description',
          weight: 'Weight',
          gate: 'Gate',
          delete: 'Delete',
        };
  return (
    <div className="grid gap-3 border-b pb-4 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)_6rem_5rem_auto]">
      <Select
        value={criterion.phase}
        onValueChange={(value) => onChange({ ...criterion, phase: value as EvaluationCriterionPhase })}
      >
        <SelectTrigger aria-label={labels.phase}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {criterionPhases.map((phase) => (
            <SelectItem key={phase} value={phase}>
              {lifecyclePhaseLabel(phase, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid gap-2">
        <Input
          value={criterion.label}
          aria-label={labels.label}
          onChange={(event) => onChange({ ...criterion, label: event.target.value })}
        />
        <Input
          value={criterion.description}
          aria-label={labels.description}
          placeholder={labels.description}
          onChange={(event) => onChange({ ...criterion, description: event.target.value })}
        />
      </div>
      <Input
        type="number"
        min={0}
        max={100}
        step="0.1"
        value={criterion.weight}
        aria-label={labels.weight}
        onChange={(event) => onChange({ ...criterion, weight: Number(event.target.value) || 0 })}
      />
      <Label className="h-9 cursor-pointer justify-start text-xs">
        <Checkbox
          checked={criterion.isGate}
          aria-label={labels.gate}
          onCheckedChange={(checked) => onChange({ ...criterion, isGate: checked === true })}
        />
        {labels.gate}
      </Label>
      <Button type="button" variant="ghost" size="icon" title={labels.delete} onClick={onRemove}>
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}
