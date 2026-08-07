import type { GenerationQuality, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

interface Props {
  locale: Locale;
  value: GenerationQuality;
  compact?: boolean;
  toolbar?: boolean;
  ariaLabel?: string;
  onChange(value: GenerationQuality): void;
}

export function QualityPicker({ value, compact = false, toolbar = false, ariaLabel, onChange }: Props) {
  const { messages } = useI18n();
  const c = messages.creator.quality;
  const options = [
    { value: 'low' as const, label: c.low, hint: c.lowHint },
    { value: 'medium' as const, label: c.medium, hint: c.mediumHint },
    { value: 'high' as const, label: c.high, hint: c.highHint },
  ];
  if (toolbar)
    return (
      <Select value={value} onValueChange={(next) => onChange(next as GenerationQuality)}>
        <SelectTrigger
          className="relative h-8 w-16 justify-center bg-surface px-5 text-sm [&>svg]:absolute [&>svg]:right-2"
          aria-label={ariaLabel ?? c.label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="min-w-24">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{c.label}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? 'outline' : 'ghost'}
            className="h-auto flex-col gap-0 py-1.5"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {!compact && <span className="text-[10px] font-normal text-muted-foreground">{option.hint}</span>}
          </Button>
        ))}
      </div>
    </div>
  );
}
