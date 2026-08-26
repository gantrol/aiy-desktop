import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';

interface CodexUsageServiceTierLabelProps {
  label: string;
  inferred: boolean;
  inferenceHint: string;
}

export function CodexUsageServiceTierLabel({ label, inferred, inferenceHint }: CodexUsageServiceTierLabelProps) {
  if (!inferred) return <span>{label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help" tabIndex={0}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{inferenceHint}</TooltipContent>
    </Tooltip>
  );
}
