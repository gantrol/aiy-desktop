import { useId } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { CODEX_USAGE_QUOTA_SAMPLE_PERCENTS } from '@/shared/contracts/codex-usage';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface CodexUsageQuotaSamplingProps {
  value: number;
  busy: boolean;
  disabled: boolean;
  onChange(value: number): void;
}

export function CodexUsageQuotaSampling({ value, busy, disabled, onChange }: CodexUsageQuotaSamplingProps) {
  const id = useId();
  const text = useI18n().messages.extensions.codexUsageInvestigator.purity;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={busy}>
      <Label htmlFor={id} className="text-xs">
        {text.samplingSpan}
      </Label>
      <Select value={String(value)} disabled={disabled} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger id={id} className="h-8 w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CODEX_USAGE_QUOTA_SAMPLE_PERCENTS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}%
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <LoaderCircleIcon role="status" aria-label={text.recalculating} className="size-4 animate-spin" />}
    </div>
  );
}
