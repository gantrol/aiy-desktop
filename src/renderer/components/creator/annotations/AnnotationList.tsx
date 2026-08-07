import { CheckCircle2Icon, HistoryIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import type { AnnotationStatus } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { AnnotationLabels, NumberedAnnotation } from '@/renderer/components/creator/annotations/types';

interface Props {
  annotations: NumberedAnnotation[];
  busyId: string | null;
  labels: AnnotationLabels;
  selectedId: string | null;
  showHistory: boolean;
  onHistoryChange(visible: boolean): void;
  onSelect(id: string): void;
  onEdit(id: string): void;
  onStatusChange(id: string, status: AnnotationStatus): void;
}

function ActionButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnnotationList({
  annotations,
  busyId,
  labels,
  selectedId,
  showHistory,
  onHistoryChange,
  onSelect,
  onEdit,
  onStatusChange,
}: Props) {
  const open = annotations.filter(({ annotation }) => annotation.status === 'OPEN');
  const closed = annotations.filter(({ annotation }) => annotation.status !== 'OPEN');
  const visible = showHistory ? annotations : open;

  return (
    <TooltipProvider>
      <section
        className="pointer-events-auto max-h-64 w-full overflow-hidden rounded-lg border border-border bg-overlay text-foreground shadow-overlay"
        aria-label={labels.note}
      >
        <header className="flex h-8 items-center justify-between px-3 text-xs text-muted-foreground">
          <span>
            {labels.openAnnotations} {open.length}
          </span>
          {closed.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              aria-pressed={showHistory}
              title={showHistory ? labels.hideHistory : labels.showHistory}
              onClick={() => onHistoryChange(!showHistory)}
            >
              <HistoryIcon className="size-3.5" />
              {labels.history} {closed.length}
            </Button>
          )}
        </header>
        <div className="max-h-52 overflow-y-auto px-2 pb-2">
          {visible.map(({ annotation, number }) => {
            const selected = annotation.id === selectedId;
            const busy = annotation.id === busyId;
            return (
              <div
                key={annotation.id}
                className={cn(
                  'group flex min-h-9 items-center gap-1 rounded-md px-1',
                  selected ? 'bg-selected text-selected-foreground' : 'hover:bg-hover',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-pressed={selected}
                  onClick={() => onSelect(annotation.id)}
                >
                  <b className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                    {number}
                  </b>
                  <span className="min-w-0 flex-1 truncate">{annotation.comment || labels.note}</span>
                  {annotation.status !== 'OPEN' && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {labels.statusLabel(annotation.status)}
                    </Badge>
                  )}
                </button>
                {annotation.status === 'OPEN' ? (
                  <>
                    <ActionButton
                      label={labels.edit}
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => onEdit(annotation.id)}
                    >
                      <PencilIcon className="size-4" />
                    </ActionButton>
                    <ActionButton
                      label={labels.resolve}
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => onStatusChange(annotation.id, 'RESOLVED')}
                    >
                      <CheckCircle2Icon className="size-4" />
                    </ActionButton>
                    <ActionButton
                      label={labels.dismiss}
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => onStatusChange(annotation.id, 'DISMISSED')}
                    >
                      <Trash2Icon className="size-4" />
                    </ActionButton>
                  </>
                ) : (
                  <ActionButton
                    label={labels.reopen}
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => onStatusChange(annotation.id, 'OPEN')}
                  >
                    <RotateCcwIcon className="size-4" />
                  </ActionButton>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </TooltipProvider>
  );
}
