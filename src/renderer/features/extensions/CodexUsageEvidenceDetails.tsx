import { useId, useState, type ReactNode } from 'react';
import type { CodexUsageInvestigation, CodexUsageTokenTotals } from '@/shared/contracts/codex-usage';
import { evidencePercent } from '@/shared/codex-usage-evidence';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { CodexModelComparisonSamples } from '@/renderer/features/extensions/CodexModelComparisonSamples';
import { CodexUsageSessionLengthResults } from '@/renderer/features/extensions/CodexUsageDetailedStatistics';
import { CodexUsageEvidenceHelp } from '@/renderer/features/extensions/CodexUsageEvidenceHelp';
import { CodexUsageTurnSpeedResults } from '@/renderer/features/extensions/CodexUsageTurnSpeedResults';
import {
  type CodexEvidenceFormatters,
  type CodexUsageDetailTopic,
} from '@/renderer/features/extensions/CodexUsageEvidenceOverview';
import { CodexUsagePurityDetails } from '@/renderer/features/extensions/CodexUsagePurity';
import { useI18n } from '@/renderer/i18n/useI18n';

const TOPICS: CodexUsageDetailTopic[] = ['money', 'quota', 'speed', 'records', 'sessions'];
const PAGE_SIZE = 50;

function UsageLedger({
  rows,
  formatters,
}: {
  rows: (CodexUsageTokenTotals & { name: string; requestCount: number })[];
  formatters: CodexEvidenceFormatters;
}) {
  const { messages } = useI18n();
  const labels = messages.extensions.codexUsageInvestigator;
  const text = labels.evidence;
  const { numbers, tokens, money } = formatters;
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  return (
    <div className="grid min-w-0 gap-2">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{labels.modelComparison.group}</TableHead>
            <TableHead numeric>{labels.table.requests}</TableHead>
            <TableHead numeric>{labels.table.tokens}</TableHead>
            <TableHead numeric>{text.subtotal} (USD)</TableHead>
            <TableHead numeric>{text.cacheSavings} (USD)</TableHead>
            <TableHead numeric>{text.coverage}</TableHead>
            <TableHead numeric>{text.unpriced}</TableHead>
            <TableHead numeric>{text.cacheDifference}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row) => {
            const coverage = evidencePercent(row.apiPricedTokens, row.totalTokens);
            return (
              <TableRow key={row.name}>
                <TableCell className="break-words">{row.name}</TableCell>
                <TableCell numeric>{numbers.format(row.requestCount)}</TableCell>
                <TableCell numeric>{tokens.format(row.totalTokens)}</TableCell>
                <TableCell numeric>
                  {row.apiEquivalentUsd === null ? '—' : money.format(row.apiEquivalentUsd)}
                </TableCell>
                <TableCell numeric>
                  {row.apiCacheSavingsUsd === null ? '—' : money.format(row.apiCacheSavingsUsd)}
                </TableCell>
                <TableCell numeric>
                  {tokens.format(row.apiPricedTokens)} / {tokens.format(row.totalTokens)}
                  <p>{coverage === null ? '—' : `${numbers.format(coverage)}%`}</p>
                </TableCell>
                <TableCell numeric>{tokens.format(Math.max(0, row.totalTokens - row.apiPricedTokens))}</TableCell>
                <TableCell numeric>
                  {row.codexCreditCacheSavings === null ? '—' : numbers.format(row.codexCreditCacheSavings)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span>
          {numbers.format(rows.length)} · {current + 1}/{count}
        </span>
        <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
          {labels.modelComparison.previousPage}
        </Button>
        <Button variant="outline" size="sm" disabled={current + 1 >= count} onClick={() => setPage(current + 1)}>
          {labels.modelComparison.nextPage}
        </Button>
      </div>
    </div>
  );
}

export function CodexUsageEvidenceDetails({
  investigation,
  topic,
  onTopicChange,
  formatters,
  numberLocale,
  quotaSamplingControl,
}: {
  investigation: CodexUsageInvestigation;
  topic: CodexUsageDetailTopic;
  onTopicChange(topic: CodexUsageDetailTopic): void;
  formatters: CodexEvidenceFormatters;
  numberLocale: string;
  quotaSamplingControl: ReactNode;
}) {
  const { messages } = useI18n();
  const labels = messages.extensions.codexUsageInvestigator;
  const text = labels.evidence;
  const id = useId();
  const { numbers, tokens } = formatters;
  const analysis = investigation.modelComparison;
  const detailNote =
    topic === 'money'
      ? `${text.moneyNote} ${text.cacheSavingsNote} ${text.cacheNote}`
      : topic === 'quota'
        ? labels.purity.method
        : topic === 'records'
          ? `${text.recordsNote} ${text.sampleBoundary}`
          : null;
  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{text.details}</Label>
        {detailNote && <CodexUsageEvidenceHelp label={detailNote}>{detailNote}</CodexUsageEvidenceHelp>}
        <Select
          value={topic}
          onValueChange={(value) => {
            if (TOPICS.includes(value as CodexUsageDetailTopic)) onTopicChange(value as CodexUsageDetailTopic);
          }}
        >
          <SelectTrigger id={id} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOPICS.map((key) => (
              <SelectItem key={key} value={key}>
                {text[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {topic === 'money' && (
        <div className="grid min-w-0 gap-3 text-xs">
          <p>
            {text.pricingDate}: API {investigation.pricing.apiVerifiedAt} · Credits{' '}
            {investigation.pricing.creditVerifiedAt}
          </p>
          <p className="break-all text-muted-foreground">
            {investigation.pricing.apiSourceUrl}
            <br />
            {investigation.pricing.creditSourceUrl}
          </p>
          <UsageLedger
            key={`${investigation.investigationId}-models`}
            rows={investigation.models.map((row) => ({
              ...row,
              name: `${row.model} · ${labels.quotaYield.modes[row.serviceTier]}${row.inferredServiceTierTokens ? ` · ${labels.quotaYield.inferredMode}` : ''}`,
            }))}
            formatters={formatters}
          />
          <h3 className="font-semibold">{text.daily}</h3>
          <UsageLedger
            key={`${investigation.investigationId}-days`}
            rows={[...investigation.days]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((row) => ({ ...row, name: row.date }))}
            formatters={formatters}
          />
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onTopicChange('records')}>
            {labels.modelComparison.selectedSamples}
          </Button>
        </div>
      )}
      {topic === 'quota' && (
        <>
          {quotaSamplingControl}
          <CodexUsagePurityDetails
            key={investigation.investigationId}
            investigation={investigation}
            formatters={formatters}
          />
        </>
      )}
      {topic === 'speed' &&
        (investigation.turnSpeed ? (
          <CodexUsageTurnSpeedResults analysis={investigation.turnSpeed} labels={labels.turnSpeed} numbers={numbers} />
        ) : (
          <p className="text-sm text-muted-foreground">{text.generationMissing}</p>
        ))}
      {topic === 'sessions' &&
        (investigation.sessionLength ? (
          <CodexUsageSessionLengthResults
            analysis={investigation.sessionLength}
            labels={labels.detailedStatistics}
            tokens={tokens}
            numbers={numbers}
            numberLocale={numberLocale}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{labels.views.detailedRequired}</p>
        ))}
      {topic === 'records' && (
        <div className="grid min-w-0 gap-3 text-xs">
          <h3 className="text-sm font-semibold">{text.audit}</h3>
          <dl className="grid grid-cols-2 gap-2 @3xl/codex-usage:grid-cols-4">
            {[
              [text.invalid, investigation.relevantInvalidRecords],
              [text.skipped, investigation.filesSkipped],
              [text.oversized, investigation.oversizedRecords],
              [text.excludedModel, analysis?.excludedModelTurnCount ?? null],
            ].map(([label, count]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{typeof count === 'number' ? numbers.format(count) : '—'}</dd>
              </div>
            ))}
          </dl>
          {analysis ? (
            <>
              {analysis.samplesTruncated && <p>{labels.modelComparison.truncated}</p>}
              <CodexModelComparisonSamples
                key={investigation.investigationId}
                first={analysis.byReasoningEffort}
                second={[]}
                labels={labels.modelComparison}
                {...formatters}
              />
            </>
          ) : (
            <p>{labels.modelComparison.rescan}</p>
          )}
        </div>
      )}
    </section>
  );
}
