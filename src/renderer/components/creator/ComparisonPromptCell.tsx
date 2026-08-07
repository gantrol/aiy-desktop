import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { diffPromptText } from '@/renderer/components/creator/generationComparisonUtils';

export type PromptDisplayMode = 'PROMPT' | 'DIFF';

interface Labels {
  prompt: string;
  added: string;
  removed: string;
  usedTerms: string;
  copyFullPrompt: string;
  promptCopied: string;
  promptEmpty: string;
  promptUnchanged: string;
}

interface Props {
  label: string;
  changeSummary: string;
  prompt: string;
  previousPrompt: string;
  fullPrompt: string;
  termNames: string[];
  mode: PromptDisplayMode;
  labels: Labels;
}

export function ComparisonPromptCell({
  label,
  changeSummary,
  prompt,
  previousPrompt,
  fullPrompt,
  termNames,
  mode,
  labels,
}: Props) {
  const [copied, setCopied] = useState(false);
  const resetCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parts = useMemo(
    () => (mode === 'DIFF' ? diffPromptText(previousPrompt, prompt) : []),
    [mode, previousPrompt, prompt],
  );
  const summary = changeSummary.trim();
  const showSummary = Boolean(summary) && summary.toLocaleLowerCase() !== label.toLocaleLowerCase();
  const changed = parts.some((part) => part.type !== 'equal');
  const technicalLabel = /^(?:V|R)\d/.test(label);

  useEffect(
    () => () => {
      if (resetCopiedTimer.current) clearTimeout(resetCopiedTimer.current);
    },
    [],
  );

  async function copyPrompt() {
    if (!fullPrompt.trim()) return;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopied(true);
      if (resetCopiedTimer.current) clearTimeout(resetCopiedTimer.current);
      resetCopiedTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex size-full min-h-0 flex-col gap-2">
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        <span className={technicalLabel ? 'font-mono font-semibold tabular-nums' : 'font-semibold'}>{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 gap-1 px-2 text-[10px]"
          disabled={!fullPrompt.trim()}
          title={copied ? labels.promptCopied : labels.copyFullPrompt}
          aria-label={copied ? labels.promptCopied : labels.copyFullPrompt}
          onClick={() => void copyPrompt()}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? labels.promptCopied : labels.copyFullPrompt}
        </Button>
      </div>
      {showSummary && (
        <p className="line-clamp-2 shrink-0 text-[11px] font-normal leading-snug text-muted-foreground">{summary}</p>
      )}
      {termNames.length > 0 && (
        <div className="flex max-h-10 shrink-0 flex-wrap items-start gap-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
          <span className="mr-0.5 text-[10px] font-normal text-muted-foreground">{labels.usedTerms}</span>
          {termNames.map((name) => (
            <Badge key={name} variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
              {name}
            </Badge>
          ))}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed font-normal whitespace-pre-wrap break-words [scrollbar-gutter:stable]"
        title={prompt || undefined}
        role="region"
        aria-label={`${label} · ${labels.prompt}`}
        tabIndex={0}
      >
        {!prompt.trim() ? (
          <span className="font-sans text-muted-foreground">{labels.promptEmpty}</span>
        ) : mode === 'PROMPT' ? (
          prompt
        ) : !changed ? (
          <span className="font-sans text-muted-foreground">{labels.promptUnchanged}</span>
        ) : (
          parts.map((part, index) =>
            part.type === 'equal' ? (
              <span key={index} className="text-muted-foreground">
                {part.value}
              </span>
            ) : (
              <span
                key={index}
                className={
                  part.type === 'added'
                    ? 'rounded-sm bg-state-changed-bg text-state-changed-fg'
                    : 'rounded-sm bg-destructive/10 text-destructive line-through decoration-destructive/60'
                }
              >
                <span className="sr-only">{part.type === 'added' ? `${labels.added}: ` : `${labels.removed}: `}</span>
                {part.value}
              </span>
            ),
          )
        )}
      </div>
    </div>
  );
}
