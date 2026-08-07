import { MessageSquareIcon } from 'lucide-react';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import { Badge } from '@/renderer/components/ui/badge';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  refinement: AnnotationRefinementState;
}

export function AnnotationRefinementInput({ refinement }: Props) {
  const labels = useI18n().messages.creator.starter;

  return (
    <section
      data-input-mode="annotation-refinement"
      className="border-t bg-primary/5 px-4 py-3"
      aria-label={labels.annotationRefinement}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <MessageSquareIcon className="size-3.5" />
        <span>{labels.annotationRefinement}</span>
        <Badge variant="outline" className="ml-auto border-primary/30 bg-surface text-primary">
          {labels.annotationRefinementCount(refinement.annotations.length)}
        </Badge>
      </div>
      <ol className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1 text-xs [scrollbar-gutter:stable]">
        {refinement.annotations.map((annotation) => (
          <li
            key={annotation.id}
            data-outgoing-annotation-id={annotation.id}
            className="flex items-start gap-2 rounded-md bg-surface/80 px-2.5 py-2"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-2xs font-semibold text-background">
              {annotation.number}
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-5">{annotation.comment}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
