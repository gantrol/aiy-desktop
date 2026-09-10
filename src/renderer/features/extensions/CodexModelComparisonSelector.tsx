import { useId } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import type { CodexModelComparisonSelection } from '@/renderer/features/extensions/codexModelComparisonSelection';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];
const MODES = ['STANDARD', 'FAST', 'UNKNOWN'] as const;
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function effortOrder(effort: string | null) {
  if (effort === null) return EFFORTS.length + 1;
  const index = EFFORTS.indexOf(effort);
  return index < 0 ? EFFORTS.length : index;
}

function ComparisonMultiSelect<T extends string | null>({
  label,
  allLabel,
  labels,
  options,
  selected,
  optionLabel,
  onChange,
}: {
  label: string;
  allLabel: string;
  labels: Pick<Labels, 'noneSelected' | 'selectOnly' | 'selectOnlyOption'>;
  options: T[];
  selected: T[] | null;
  optionLabel(value: T): string;
  onChange(value: T[] | null): void;
}) {
  const id = useId();
  const values = selected ?? options;
  const allSelected = options.length > 0 && options.every((value) => values.includes(value));
  const summary = selected === null ? allLabel : values.map(optionLabel).join(', ') || labels.noneSelected;
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className="h-8 w-full min-w-0 justify-between gap-2 px-3 text-xs font-normal"
          >
            <span className="truncate" title={summary}>
              {summary}
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={label} className="w-64 max-w-[calc(100vw-2rem)] p-2">
          <div className="flex items-center gap-2 border-b px-1 pb-2">
            <Checkbox
              id={`${id}-all`}
              checked={allSelected ? true : values.length > 0 ? 'indeterminate' : false}
              onCheckedChange={() => onChange(allSelected ? [] : null)}
            />
            <Label htmlFor={`${id}-all`} className="flex-1 text-xs">
              {allLabel}
            </Label>
          </div>
          <div className="grid max-h-[min(18rem,var(--radix-popover-content-available-height))] gap-1 overflow-y-auto pt-1">
            {options.map((option, index) => (
              <div key={JSON.stringify(option)} className="flex items-center gap-2 rounded-sm p-1 hover:bg-hover">
                <Checkbox
                  id={`${id}-${index}`}
                  checked={values.includes(option)}
                  onCheckedChange={(checked) => {
                    const next = checked === true ? [...values, option] : values.filter((value) => value !== option);
                    onChange(options.every((value) => next.includes(value)) ? null : next);
                  }}
                />
                <Label htmlFor={`${id}-${index}`} className="min-w-0 flex-1 break-all text-xs">
                  {optionLabel(option)}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="2xs"
                  aria-label={labels.selectOnlyOption.replace('{option}', optionLabel(option))}
                  disabled={selected?.length === 1 && selected[0] === option}
                  onClick={() => onChange([option])}
                >
                  {labels.selectOnly}
                </Button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CodexModelComparisonSelector({
  selection,
  groups,
  label,
  labels,
  onChange,
}: {
  selection: CodexModelComparisonSelection;
  groups: CodexModelComparisonRow[];
  label: string;
  labels: Labels;
  onChange(value: CodexModelComparisonSelection): void;
}) {
  // Keep saved values selectable even when the current report has no matching samples.
  const models = [...new Set([...groups.map((group) => group.model), ...(selection.models ?? [])])].sort((a, b) =>
    a.localeCompare(b),
  );
  const modes = MODES.filter(
    (mode) => groups.some((group) => group.serviceTier === mode) || selection.modes?.includes(mode),
  );
  const efforts = [...new Set([...groups.map((group) => group.reasoningEffort), ...(selection.efforts ?? [])])].sort(
    (a, b) => effortOrder(a) - effortOrder(b) || (a ?? '').localeCompare(b ?? ''),
  );
  return (
    <fieldset className="@container/codex-comparison-side min-w-0">
      <legend className="mb-2 text-xs font-medium">{label}</legend>
      <div className="grid min-w-0 gap-2 @xs/codex-comparison-side:grid-cols-2 @lg/codex-comparison-side:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 @xs/codex-comparison-side:col-span-2 @lg/codex-comparison-side:col-span-1">
          <ComparisonMultiSelect
            label={labels.model}
            allLabel={labels.allModels}
            labels={labels}
            options={models}
            selected={selection.models}
            optionLabel={(model) => model}
            onChange={(models) => onChange({ ...selection, models })}
          />
        </div>
        <ComparisonMultiSelect
          label={labels.mode}
          allLabel={labels.allModes}
          labels={labels}
          options={modes}
          selected={selection.modes}
          optionLabel={(mode) => labels.modes[mode]}
          onChange={(modes) => onChange({ ...selection, modes })}
        />
        <ComparisonMultiSelect
          label={labels.effort}
          allLabel={labels.allEfforts}
          labels={labels}
          options={efforts}
          selected={selection.efforts}
          optionLabel={(effort) => effort ?? labels.unknownEffort}
          onChange={(efforts) => onChange({ ...selection, efforts })}
        />
      </div>
    </fieldset>
  );
}
