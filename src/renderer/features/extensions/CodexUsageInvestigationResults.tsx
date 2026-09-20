import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react';
import type { CodexUsageInvestigation } from '@/shared/contracts';
import { CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT } from '@/shared/contracts/codex-usage';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { CodexModelPairComparison } from '@/renderer/features/extensions/CodexModelPairComparison';
import {
  CodexUsageEvidenceOverview,
  type CodexUsageDetailTopic,
} from '@/renderer/features/extensions/CodexUsageEvidenceOverview';
import { CodexUsageEvidenceDetails } from '@/renderer/features/extensions/CodexUsageEvidenceDetails';
import { CodexUsageQuotaSampling } from '@/renderer/features/extensions/CodexUsageQuotaSampling';
import { useI18n } from '@/renderer/i18n/useI18n';

type UsageLabels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator'];
type View = 'glance' | 'details' | 'compare';
const VIEWS: View[] = ['glance', 'details', 'compare'];

export const CodexUsageInvestigationResults = memo(function CodexUsageInvestigationResults({
  investigation,
  labels,
  numberLocale,
  displayTimeZone,
  quotaSamplingBusy,
  quotaSamplingDisabled,
  onQuotaSamplingChange,
}: {
  investigation: CodexUsageInvestigation;
  labels: UsageLabels;
  numberLocale: string;
  displayTimeZone: string;
  quotaSamplingBusy: boolean;
  quotaSamplingDisabled: boolean;
  onQuotaSamplingChange(value: number): void;
}) {
  const text = useI18n().messages.extensions.codexUsageInvestigator.evidence;
  const [view, setView] = useState<View>('glance');
  const [visited, setVisited] = useState<View[]>(['glance']);
  const [topic, setTopic] = useState<CodexUsageDetailTopic>('money');
  const glanceRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef(false);
  const formatters = useMemo(
    () => ({
      tokens: new Intl.NumberFormat(numberLocale, { notation: 'compact', maximumFractionDigits: 2 }),
      numbers: new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }),
      money: new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }),
      date: new Intl.DateTimeFormat(numberLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: displayTimeZone,
      }),
    }),
    [numberLocale, displayTimeZone],
  );
  function navigate(next: View, focus = false) {
    focusRequested.current = focus;
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
    setView(next);
  }
  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    (view === 'details' ? detailsRef : glanceRef).current?.focus();
  }, [view]);
  const { date, numbers } = formatters;
  const icons = { glance: ActivityIcon, details: SearchIcon, compare: SlidersHorizontalIcon };
  const quotaSamplingControl = (
    <CodexUsageQuotaSampling
      value={investigation.quotaPurity?.minimumQuotaPercent ?? CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT}
      busy={quotaSamplingBusy}
      disabled={quotaSamplingDisabled}
      onChange={onQuotaSamplingChange}
    />
  );
  return (
    <div className="grid min-w-0 gap-3">
      <header className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p>
          {text.scope}: {investigation.from ? date.format(new Date(investigation.from)) : text.allHistory} –{' '}
          {date.format(new Date(investigation.to))} · {displayTimeZone}
        </p>
        <p>
          {text.generated}: {date.format(new Date(investigation.generatedAt))}
        </p>
      </header>
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (VIEWS.includes(value as View)) navigate(value as View);
        }}
        activationMode="manual"
        className="block min-w-0"
      >
        <div className="overflow-x-auto border-b">
          <TabsList className="min-w-max justify-start">
            {VIEWS.map((key) => {
              const Icon = icons[key];
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  ref={key === 'glance' ? glanceRef : key === 'details' ? detailsRef : undefined}
                  className="gap-1.5 px-3"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {text[key]}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value="glance" forceMount className="pt-3 data-[state=inactive]:hidden">
          <CodexUsageEvidenceOverview
            investigation={investigation}
            formatters={formatters}
            quotaSamplingControl={quotaSamplingControl}
            onInspect={(next) => {
              setTopic(next);
              navigate('details', true);
            }}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {labels.metrics.requests}: {numbers.format(investigation.requestCount)} · {labels.metrics.sessions}:{' '}
            {numbers.format(investigation.sessionCount)} · {labels.overview.completedTurns}:{' '}
            {investigation.turnSpeed ? numbers.format(investigation.turnSpeed.completedTurnCount) : '—'}
          </p>
        </TabsContent>
        <TabsContent value="details" forceMount className="grid min-w-0 gap-3 pt-3 data-[state=inactive]:hidden">
          {visited.includes('details') && (
            <CodexUsageEvidenceDetails
              investigation={investigation}
              topic={topic}
              onTopicChange={setTopic}
              formatters={formatters}
              numberLocale={numberLocale}
              quotaSamplingControl={quotaSamplingControl}
            />
          )}
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => navigate('glance', true)}>
            {text.back}
          </Button>
        </TabsContent>
        <TabsContent value="compare" forceMount className="grid min-w-0 gap-3 pt-3 data-[state=inactive]:hidden">
          {visited.includes('compare') &&
            (investigation.modelComparison ? (
              <>
                {investigation.modelComparison.samplesTruncated && (
                  <Badge variant="outline">{labels.modelComparison.truncated}</Badge>
                )}
                <CodexModelPairComparison
                  key={investigation.investigationId}
                  byReasoningEffort={investigation.modelComparison.byReasoningEffort}
                  labels={labels.modelComparison}
                  {...formatters}
                  report={investigation}
                  samplesTruncated={investigation.modelComparison.samplesTruncated}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{labels.modelComparison.rescan}</p>
            ))}
        </TabsContent>
      </Tabs>
      <footer className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>{investigation.sourceLabel}</span>
        <span>
          {numbers.format(investigation.filesScanned)} {labels.metrics.scannedFiles}
        </span>
        {investigation.warnings
          .filter((warning) => !warning.startsWith('QUOTA_'))
          .map((warning) => (
            <Badge key={warning} variant="outline">
              {labels.warnings[warning]}
            </Badge>
          ))}
      </footer>
    </div>
  );
});
