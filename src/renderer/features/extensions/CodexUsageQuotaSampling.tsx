import { useId } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { CODEX_USAGE_QUOTA_SAMPLE_PERCENTS } from '@/shared/contracts/codex-usage';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
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
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-busy={busy}>
      <span id={id} className="text-xs">
        {text.samplingSpan}
      </span>
      <Segmented
        type="single"
        value={String(value)}
        disabled={disabled}
        aria-labelledby={id}
        className="max-w-full"
        onValueChange={(next) => {
          if (next) onChange(Number(next));
        }}
      >
        {CODEX_USAGE_QUOTA_SAMPLE_PERCENTS.map((option) => (
          <SegmentedItem key={option} value={String(option)} className="px-2">
            {option}%
          </SegmentedItem>
        ))}
      </Segmented>
      {busy && <LoaderCircleIcon role="status" aria-label={text.recalculating} className="size-4 animate-spin" />}
    </div>
  );
}
