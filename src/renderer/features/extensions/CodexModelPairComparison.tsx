import { useId, useMemo, useState } from 'react';
import { ArrowLeftRightIcon, ChevronDownIcon, DownloadIcon, SaveIcon } from 'lucide-react';
import type { CodexModelComparisonMetric, CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import type { CodexUsageInvestigation } from '@/shared/contracts/codex-usage';
import {
  defaultComparisonGroups,
  modelComparisonCautions,
  parseEvidenceThreshold,
  summarizeModelSamples,
} from '@/shared/codex-usage-evidence';
import { codexModelComparisonDistribution } from '@/shared/codex-model-comparison-distribution';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { CodexModelDistributionChart } from '@/renderer/features/extensions/CodexModelDistributionChart';
import { CodexModelEvidenceChart } from '@/renderer/features/extensions/CodexModelEvidenceChart';
import { CodexModelComparisonChartLegend } from '@/renderer/features/extensions/CodexModelComparisonChartLegend';
import { CodexModelComparisonSelector } from '@/renderer/features/extensions/CodexModelComparisonSelector';
import { CodexModelComparisonSamples } from '@/renderer/features/extensions/CodexModelComparisonSamples';
import { CodexModelComparisonEvidence } from '@/renderer/features/extensions/CodexModelComparisonEvidence';
import { CodexModelComparisonOverall } from '@/renderer/features/extensions/CodexModelComparisonOverall';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import { codexModelComparisonChartData } from '@/renderer/features/extensions/codexModelComparisonChart';
import {
  selectedCodexModelComparisonGroups,
  type CodexModelComparisonSelection,
} from '@/renderer/features/extensions/codexModelComparisonSelection';
import {
  readComparisonWorkspace,
  saveComparisonWorkspace,
  readComparisonPlans,
  saveNamedComparison,
  freezeCodexComparison,
  downloadCodexComparison,
  type CodexComparisonWorkspace,
} from '@/renderer/features/extensions/codexUsageComparisonWorkspace';
import { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];
const METRICS: CodexModelComparisonMetric[] = [
  'durationMs',
  'requests',
  'totalTokens',
  'outputTokens',
  'apiEquivalentUsd',
  'codexCredits',
];
const CHARTS: CodexComparisonWorkspace['view'][] = ['points', 'cumulative', 'quantiles'];

function selectionFor(row: CodexModelComparisonRow | null): CodexModelComparisonSelection {
  return {
    models: row ? [row.model] : [],
    modes: row ? [row.serviceTier] : [],
    efforts: row ? [row.reasoningEffort] : [],
  };
}

function comparisonSelectionLabel(value: CodexModelComparisonSelection, labels: Labels) {
  return [
    value.models === null ? labels.allModels : value.models.join(', ') || labels.noneSelected,
    value.modes === null
      ? labels.allModes
      : value.modes.map((mode) => labels.modes[mode]).join(', ') || labels.noneSelected,
    value.efforts === null
      ? labels.allEfforts
      : value.efforts.map((effort) => effort ?? labels.unknownEffort).join(', ') || labels.noneSelected,
  ].join(' · ');
}

interface CodexModelPairComparisonProps {
  byReasoningEffort: CodexModelComparisonRow[];
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
  report?: CodexUsageInvestigation;
  samplesTruncated: boolean;
}

export function CodexModelPairComparison({
  byReasoningEffort,
  labels,
  numbers,
  tokens,
  money,
  date,
  report,
  samplesTruncated,
}: CodexModelPairComparisonProps) {
  const text = useI18n().messages.extensions.codexUsageInvestigator.evidence;
  const id = useId();
  const [settings, setSettings] = useState(readComparisonWorkspace);
  const { metric, view, threshold } = settings;
  const defaults = useMemo(() => defaultComparisonGroups(byReasoningEffort), [byReasoningEffort]);
  const [selectionA, selectionB] = settings.selection;
  const retentionKnown = !samplesTruncated;
  const pair = useMemo(() => {
    const selections = [selectionA, selectionB];
    const side = (index: 0 | 1) => {
      const selection = selections[index] ?? selectionFor(defaults[index]);
      return { selection, groups: selectedCodexModelComparisonGroups(byReasoningEffort, selection) };
    };
    return [side(0), side(1)] as const;
  }, [byReasoningEffort, defaults, selectionA, selectionB]);
  const resolved: CodexComparisonWorkspace = { ...settings, selection: [pair[0].selection, pair[1].selection] };
  const summaries = useMemo(
    () =>
      [
        summarizeModelSamples(pair[0].groups, metric, retentionKnown),
        summarizeModelSamples(pair[1].groups, metric, retentionKnown),
      ] as const,
    [pair, metric, retentionKnown],
  );
  const distributions = useMemo(
    () => (view === 'quantiles' ? summaries.map((summary) => codexModelComparisonDistribution(summary.values)) : []),
    [summaries, view],
  );
  const chartData = useMemo(
    () => codexModelComparisonChartData([pair[0].groups, pair[1].groups], metric, labels.unknownEffort),
    [pair, metric, labels.unknownEffort],
  );
  const cautions = modelComparisonCautions(pair[0].groups, pair[1].groups);
  const notes = [
    cautions.empty && text.emptySelection,
    cautions.mixed && text.mixed,
    cautions.differentEffort && text.effortMismatch,
    cautions.differentMode && text.modeMismatch,
    cautions.overlap && text.overlap,
    cautions.unknown && text.unknown,
  ].filter((note): note is string => Boolean(note));
  const format = (value: number) =>
    metric === 'apiEquivalentUsd'
      ? money.format(value)
      : metric === 'durationMs'
        ? numbers.format(value / 1_000)
        : metric === 'totalTokens' || metric === 'outputTokens'
          ? tokens.format(value)
          : numbers.format(value);
  function change(value: CodexComparisonWorkspace) {
    setSettings(value);
    saveComparisonWorkspace(value);
  }
  const seriesFor = (index: 0 | 1) => ({
    label: comparisonSelectionLabel(pair[index].selection, labels),
    distribution: distributions[index] ?? null,
    total: summaries[index].eligible,
    groups: chartData.sides[index],
  });
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!defaults[1]}
          onClick={() =>
            change({
              ...resolved,
              selection: [selectionFor(defaults[0]), selectionFor(defaults[1])],
              metric: 'durationMs',
              threshold: '',
            })
          }
        >
          {text.fastPreset}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => change({ ...resolved, selection: [pair[1].selection, pair[0].selection] })}
        >
          <ArrowLeftRightIcon aria-hidden="true" className="size-3.5" />
          {text.swap}
        </Button>
      </div>
      <div className="grid min-w-0 gap-4 @3xl/codex-usage:grid-cols-2">
        {pair.map((side, index) => (
          <CodexModelComparisonSelector
            key={index}
            selection={side.selection}
            groups={byReasoningEffort}
            label={index ? labels.compareB : labels.compareA}
            labels={labels}
            onChange={(value) =>
              change({ ...resolved, selection: index ? [pair[0].selection, value] : [value, pair[1].selection] })
            }
          />
        ))}
      </div>
      <div className="grid gap-3 @xl/codex-usage:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-metric`}>{labels.distribution}</Label>
          <Select
            value={metric}
            onValueChange={(value) => {
              if (METRICS.includes(value as CodexModelComparisonMetric))
                change({ ...resolved, metric: value as CodexModelComparisonMetric, threshold: '' });
            }}
          >
            <SelectTrigger id={`${id}-metric`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map((key) => (
                <SelectItem key={key} value={key}>
                  {labels.metrics[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-chart`}>{text.chart}</Label>
          <Select
            value={view}
            onValueChange={(value) => {
              if (CHARTS.includes(value as CodexComparisonWorkspace['view']))
                change({ ...resolved, view: value as CodexComparisonWorkspace['view'] });
            }}
          >
            <SelectTrigger id={`${id}-chart`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHARTS.map((key) => (
                <SelectItem key={key} value={key}>
                  {text[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CodexUsageEvidenceHelp label={`${text.observationOnly} ${text.contextMissing}`}>
          {text.observationOnly} {text.contextMissing}
        </CodexUsageEvidenceHelp>
        {notes.map((note) => (
          <Badge key={note} variant="outline">
            {note}
          </Badge>
        ))}
      </div>
      <div className="grid min-w-0 gap-1 text-xs">
        {pair.map((side, index) => (
          <p key={index} className="break-words">
            {index ? labels.compareB : labels.compareA}: {comparisonSelectionLabel(side.selection, labels)}
          </p>
        ))}
      </div>
      <CodexModelComparisonOverall
        groups={[pair[0].groups, pair[1].groups]}
        labels={labels}
        numbers={numbers}
        tokens={tokens}
        money={money}
      />
      <CodexModelComparisonChartLegend
        configurations={chartData.configurations}
        label={`${labels.model} · ${labels.effort}`}
      />
      {view === 'quantiles' ? (
        <CodexModelDistributionChart
          series={[seriesFor(0), seriesFor(1)]}
          metricLabel={labels.metrics[metric]}
          labels={labels}
          numbers={numbers}
          format={format}
        />
      ) : (
        <CodexModelEvidenceChart
          summaries={summaries}
          groups={chartData.sides}
          view={view}
          format={format}
          label={labels.metrics[metric]}
          text={text}
        />
      )}
      <CodexModelComparisonEvidence
        summaries={summaries}
        metric={metric}
        metricLabel={labels.metrics[metric]}
        numbers={numbers}
        format={format}
        limit={threshold}
        onLimitChange={(value) => change({ ...resolved, threshold: value })}
        text={text}
      />
      <Collapsible defaultOpen={false} className="min-w-0 border-t pt-3">
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group gap-2 px-0 hover:bg-transparent">
              <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
              {labels.selectedSamples}
            </Button>
          </CollapsibleTrigger>
          <CodexUsageEvidenceHelp label={text.sampleBoundary}>{text.sampleBoundary}</CodexUsageEvidenceHelp>
        </div>
        <CollapsibleContent className="min-w-0 pt-2">
          <CodexModelComparisonSamples
            key={JSON.stringify(resolved.selection)}
            first={pair[0].groups}
            second={pair[1].groups}
            labels={labels}
            numbers={numbers}
            tokens={tokens}
            money={money}
            date={date}
          />
        </CollapsibleContent>
      </Collapsible>
      <ComparisonPlans
        settings={resolved}
        report={report}
        groups={[pair[0].groups, pair[1].groups]}
        date={date}
        onLoad={change}
      />
    </div>
  );
}

function ComparisonPlans({
  settings,
  report,
  groups,
  date,
  onLoad,
}: {
  settings: CodexComparisonWorkspace;
  report: CodexUsageInvestigation | undefined;
  groups: readonly [readonly CodexModelComparisonRow[], readonly CodexModelComparisonRow[]];
  date: Intl.DateTimeFormat;
  onLoad(settings: CodexComparisonWorkspace): void;
}) {
  const text = useI18n().messages.extensions.codexUsageInvestigator.evidence;
  const id = useId();
  const [plans, setPlans] = useState(readComparisonPlans);
  const [planName, setPlanName] = useState('');
  const [planToLoad, setPlanToLoad] = useState('');
  const [status, setStatus] = useState('');
  const invalidLimit =
    settings.threshold.trim() !== '' && parseEvidenceThreshold(settings.threshold, settings.metric) === null;
  function savePlan() {
    const result = saveNamedComparison(planName, settings);
    if (result.status === 'saved') {
      setPlans(result.plans);
      setPlanToLoad(planName.trim());
    }
    setStatus(
      result.status === 'saved' ? text.saved : result.status === 'limit' ? text.limitReached : text.storageFailed,
    );
  }
  function exportComparison() {
    if (!report) return;
    try {
      downloadCodexComparison(freezeCodexComparison(report, settings, groups, date.resolvedOptions().timeZone));
      setStatus(text.exported);
    } catch {
      setStatus(text.exportFailed);
    }
  }
  return (
    <section className="grid gap-3 border-t pt-3" aria-label={text.savedPlans}>
      <div className="flex items-center gap-1 text-sm font-medium">
        <span>{text.savedPlans}</span>
        <CodexUsageEvidenceHelp label={text.planNote}>{text.planNote}</CodexUsageEvidenceHelp>
      </div>
      <div className="grid gap-3 @3xl/codex-usage:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>{text.planName}</Label>
          <Input
            id={`${id}-name`}
            value={planName}
            maxLength={96}
            onChange={(event) => setPlanName(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={!planName.trim() || invalidLimit}
            onClick={savePlan}
          >
            <SaveIcon className="size-3.5" aria-hidden="true" />
            {plans.some((plan) => plan.name === planName.trim()) ? text.overwrite : text.save}
          </Button>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-plans`}>{text.savedPlans}</Label>
          <Select value={planToLoad} onValueChange={setPlanToLoad}>
            <SelectTrigger id={`${id}-plans`}>
              <SelectValue placeholder={text.choosePlan} />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.name} value={plan.name}>
                  {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={!plans.some((plan) => plan.name === planToLoad)}
            onClick={() => {
              const plan = plans.find((item) => item.name === planToLoad);
              if (plan) {
                onLoad(plan.settings);
                setStatus('');
                setPlanName(plan.name);
              }
            }}
          >
            {text.load}
          </Button>
        </div>
      </div>
      {report && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={invalidLimit || groups.every((side) => side.every((group) => !group.samples?.length))}
            onClick={exportComparison}
          >
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            {text.export}
          </Button>
          <CodexUsageEvidenceHelp label={text.exportNote}>{text.exportNote}</CodexUsageEvidenceHelp>
        </div>
      )}
      <p role="status" className="min-h-4 text-xs">
        {status}
      </p>
    </section>
  );
}
