import { CheckIcon, CircleAlertIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import type { GenerationRunDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { generationErrorPresentation } from '@/renderer/components/generation/generation-error-presentation';

interface Props {
  run: GenerationRunDto;
  className?: string;
  summaryClassName?: string;
  showIcon?: boolean;
  align?: 'start' | 'center' | 'end';
}

export function GenerationErrorNotice({ run, className, summaryClassName, showIcon = true, align = 'start' }: Props) {
  const { messages } = useI18n();
  const copy = messages.app.generationErrors;
  const presentation = generationErrorPresentation(run, messages);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyDetails(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(presentation.detailsText);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  const ErrorIcon = presentation.moderation ? TriangleAlertIcon : CircleAlertIcon;
  return (
    <HoverCard openDelay={250} closeDelay={250}>
      <HoverCardTrigger asChild>
        <span
          data-generation-error-summary
          tabIndex={0}
          className={cn(
            'inline-flex min-w-0 cursor-help items-center gap-1.5 text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
          aria-label={`${presentation.summary} ${copy.detailsHint}`}
        >
          {showIcon && <ErrorIcon className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className={cn('border-b border-dotted border-current/50', summaryClassName)}>
            {presentation.summary}
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align={align}
        sideOffset={8}
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <strong className="min-w-0 flex-1 text-xs font-semibold">{copy.detailsTitle}</strong>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={copyDetails}>
            {copyState === 'copied' ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            {copyState === 'copied' ? copy.copied : copyState === 'failed' ? copy.copyFailed : copy.copyDetails}
          </Button>
        </header>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-foreground-secondary">
          {presentation.detailsText}
        </pre>
      </HoverCardContent>
    </HoverCard>
  );
}
