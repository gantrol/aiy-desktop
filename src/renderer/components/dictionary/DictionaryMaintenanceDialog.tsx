import { useState } from 'react';
import { ChevronDownIcon, ClipboardCheckIcon, RefreshCwIcon } from 'lucide-react';
import type {
  DictionaryMaintenanceCandidateDto,
  DictionaryMaintenanceReportDto,
  DictionaryMaintenanceSeverity,
  Locale,
} from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { cn } from '@/renderer/lib/utils';

interface Props {
  open: boolean;
  locale: Locale;
  reports: DictionaryMaintenanceReportDto[];
  busy: boolean;
  error: string;
  onOpenChange(open: boolean): void;
  onRefresh(): void | Promise<void>;
  onOpenTerm(termId: string): void;
}

type MaintenanceMessages = MessageCatalog['dictionary']['maintenance'];

function severityClass(severity: DictionaryMaintenanceSeverity) {
  if (severity === 'CRITICAL') return 'border-destructive/30 bg-destructive-surface text-destructive';
  if (severity === 'WARNING') return 'border-warning/30 bg-warning-surface text-warning';
  return 'border-border bg-surface-sunken text-foreground-secondary';
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-background px-2.5 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CandidateCard({
  candidate,
  labels,
  onOpenTerm,
}: {
  candidate: DictionaryMaintenanceCandidateDto;
  labels: MaintenanceMessages;
  onOpenTerm(termId: string): void;
}) {
  return (
    <article data-term-id={candidate.termId} className="overflow-hidden rounded-md border bg-background">
      <div className="flex min-w-0 items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-xs">{candidate.title}</strong>
            <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[10px]">
              {candidate.titleLocale}
            </Badge>
            <Badge
              variant="outline"
              className={cn('h-5 rounded-sm px-1.5 text-[10px]', severityClass(candidate.severity))}
            >
              {labels.severity[candidate.severity]}
            </Badge>
          </div>
        </div>
        <Button
          data-action="dictionary-maintenance-open-term"
          type="button"
          variant="ghost"
          size="2xs"
          onClick={() => onOpenTerm(candidate.termId)}
        >
          {labels.openTerm}
        </Button>
      </div>
      <div className="border-y bg-surface-sunken/35 px-3 py-1.5 text-2xs text-muted-foreground tabular-nums">
        {labels.prompts} {candidate.distinctPromptSeries} · {candidate.citationCount}
      </div>
      <div className="grid gap-2 p-2">
        {candidate.issues.map((issue, index) => (
          <div key={`${candidate.id}:${issue.code}:${index}`} className="rounded border bg-surface px-2.5 py-2">
            <p className="text-xs font-medium">{issue.reason}</p>
            <dl className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 text-2xs leading-5">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{labels.before}</dt>
                <dd className="line-clamp-2 break-words">{issue.before || labels.blank}</dd>
              </div>
              <span aria-hidden="true" className="mt-5 text-muted-foreground">
                →
              </span>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{labels.expected}</dt>
                <dd className="line-clamp-2 break-words">{issue.expected}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </article>
  );
}

function ReportCard({
  report,
  locale,
  labels,
  initiallyOpen,
  latest,
  onOpenTerm,
}: {
  report: DictionaryMaintenanceReportDto;
  locale: Locale;
  labels: MaintenanceMessages;
  initiallyOpen: boolean;
  latest: boolean;
  onOpenTerm(termId: string): void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [visibleCount, setVisibleCount] = useState(24);
  const timestamp = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(report.createdAt));
  const visibleCandidates = report.candidates.slice(0, visibleCount);

  return (
    <Collapsible
      data-maintenance-report-id={report.id}
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border bg-surface"
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <ClipboardCheckIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{timestamp}</span>
            {latest && <Badge variant="secondary">{labels.latest}</Badge>}
            {report.isStale && <Badge variant="outline">{labels.stale}</Badge>}
          </div>
          <div className="mt-0.5 text-2xs text-muted-foreground">
            {report.summary.termCount} {labels.terms} · {report.summary.candidateTermCount} {labels.candidates}
          </div>
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={open ? labels.close : labels.description}>
            <ChevronDownIcon className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="grid gap-3 border-t bg-surface-sunken/25 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label={labels.terms} value={report.summary.termCount} />
            <Metric label={labels.ready} value={report.summary.readyTermCount} />
            <Metric label={labels.uncited} value={report.summary.uncitedTermCount} />
            <Metric label={labels.candidates} value={report.summary.candidateTermCount} />
            <Metric label={labels.missingDefinition} value={report.summary.missingDefinitionCount} />
            <Metric label={labels.missingCategory} value={report.summary.missingCategoryCount} />
            <Metric label={labels.missingPositive} value={report.summary.missingPositiveExpressionCount} />
            <Metric label={labels.duplicates} value={report.summary.duplicateExpressionGroupCount} />
          </div>

          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold">{labels.candidates}</h3>
              {report.candidates.length > 0 && (
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {labels.showing(visibleCandidates.length, report.summary.candidateTermCount)}
                </span>
              )}
            </div>
            {visibleCandidates.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleCandidates.map((candidate) => (
                  <CandidateCard
                    key={`${report.id}:${candidate.id}`}
                    candidate={candidate}
                    labels={labels}
                    onOpenTerm={onOpenTerm}
                  />
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{labels.none}</span>
            )}
            {visibleCandidates.length < report.candidates.length && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-center"
                onClick={() => setVisibleCount((count) => count + 24)}
              >
                {labels.more}
              </Button>
            )}
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DictionaryMaintenanceDialog({
  open,
  locale,
  reports,
  busy,
  error,
  onOpenChange,
  onRefresh,
  onOpenTerm,
}: Props) {
  const labels = useI18n().messages.dictionary.maintenance;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-dialog="dictionary-maintenance"
        aria-busy={busy}
        className="h-[88vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheckIcon className="size-5" />
              {labels.title}
            </DialogTitle>
            <Button
              data-action="dictionary-maintenance-refresh"
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void onRefresh()}
            >
              <RefreshCwIcon className={cn('size-3.5', busy && 'animate-spin')} />
              {labels.refresh}
            </Button>
          </div>
          <DialogDescription className="sr-only">{labels.description}</DialogDescription>
        </DialogHeader>
        <ScrollArea
          type="always"
          data-testid="dictionary-maintenance-scroll"
          className="min-h-0 [&_[data-slot=scroll-area-scrollbar]]:opacity-100"
        >
          <div className="grid gap-2 p-4 pr-5">
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive-surface px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}
            {!reports.length && !busy && !error && (
              <p className="py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>
            )}
            {reports.map((report, index) => (
              <ReportCard
                key={report.id}
                report={report}
                locale={locale}
                labels={labels}
                initiallyOpen={index === 0}
                latest={index === 0}
                onOpenTerm={onOpenTerm}
              />
            ))}
          </div>
        </ScrollArea>
        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { Props as DictionaryMaintenanceDialogProps };
