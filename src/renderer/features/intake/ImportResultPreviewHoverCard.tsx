import { useMemo, useState } from 'react';
import { diffPromptText } from '@/renderer/components/creator/generationComparisonUtils';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  src: string;
  name: string;
  prompt: string;
  below?: { name: string; prompt: string };
}

function PreviewImage({ src, name, large = false }: Pick<Props, 'src' | 'name'> & { large?: boolean }) {
  const className = large
    ? 'relative z-10 size-full object-contain'
    : 'relative z-10 size-full rounded-sm object-contain';
  return <img src={src} alt={large ? name : ''} className={className} decoding="async" draggable={false} />;
}

export function ImportResultPreviewHoverCard({ src, name, prompt, below }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.resultsOrganizer;
  const reviewLabels = messages.intake.review;
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => (open && below ? diffPromptText(below.prompt, prompt) : []), [below, open, prompt]);
  const promptChanged = diff.some((part) => part.type !== 'equal');

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="relative isolate size-11 overflow-hidden rounded-md border bg-surface-sunken p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={reviewLabels.previewItem(name)}
        >
          <ImageAmbientBackdrop src={src} loading="lazy" />
          <PreviewImage src={src} name={name} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(40rem,calc(100vw-3rem))] max-w-none overflow-hidden p-0"
      >
        <div className="grid h-[min(58vh,30rem)] grid-cols-2">
          <div className="relative isolate min-h-0 overflow-hidden bg-surface-sunken p-3">
            <ImageAmbientBackdrop src={src} />
            <PreviewImage src={src} name={name} large />
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain border-l p-4">
            <h3 className="text-sm font-semibold">{name}</h3>
            <section className="mt-4">
              <h4 className="text-xs font-medium text-muted-foreground">{labels.prompt}</h4>
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {prompt || <span className="font-sans text-muted-foreground">{labels.promptEmpty}</span>}
              </div>
            </section>
            {below && (
              <section className="mt-5 border-t pt-4">
                <h4 className="text-xs font-medium text-muted-foreground">{labels.promptDiffWithBelow(below.name)}</h4>
                <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {!prompt && !below.prompt ? (
                    <span className="font-sans text-muted-foreground">{labels.promptEmpty}</span>
                  ) : !promptChanged ? (
                    <span className="font-sans text-muted-foreground">{labels.promptUnchanged}</span>
                  ) : (
                    diff.map((part, index) =>
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
                          <span className="sr-only">
                            {part.type === 'added' ? `${labels.diffAdded}: ` : `${labels.diffRemoved}: `}
                          </span>
                          {part.value}
                        </span>
                      ),
                    )
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
