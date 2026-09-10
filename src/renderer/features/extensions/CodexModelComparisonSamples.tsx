import { useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import { Button } from '@/renderer/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import type { useI18n } from '@/renderer/i18n/useI18n';

type Labels = ReturnType<typeof useI18n>['messages']['extensions']['codexUsageInvestigator']['modelComparison'];
const PAGE_SIZE = 50;

export function CodexModelComparisonSamples({
  first,
  second,
  labels,
  numbers,
  tokens,
  money,
  date,
}: {
  first: CodexModelComparisonRow[];
  second: CodexModelComparisonRow[];
  labels: Labels;
  numbers: Intl.NumberFormat;
  tokens: Intl.NumberFormat;
  money: Intl.NumberFormat;
  date: Intl.DateTimeFormat;
}) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const inFirst = new Set(first);
    const inSecond = new Set(second);
    return [...new Set([...first, ...second])]
      .flatMap((group, groupIndex) =>
        (group.samples ?? []).map((sample, sampleIndex) => ({
          group,
          sample,
          key: `${groupIndex}:${sampleIndex}`,
          inFirst: inFirst.has(group),
          inSecond: inSecond.has(group),
        })),
      )
      .sort((a, b) => b.sample[0] - a.sample[0]);
  }, [first, second]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * PAGE_SIZE;
  const format = (value: number | null, formatter: Intl.NumberFormat) =>
    value === null ? '—' : formatter.format(value);
  if (!rows.length) return <div className="py-3 text-sm text-muted-foreground">{labels.noSelectedSamples}</div>;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="min-w-0 max-w-full border-y">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead numeric scope="col">
                {labels.sample}
              </TableHead>
              <TableHead scope="col">{labels.group}</TableHead>
              <TableHead scope="col">{labels.model}</TableHead>
              <TableHead scope="col">{labels.mode}</TableHead>
              <TableHead scope="col">{labels.effort}</TableHead>
              <TableHead scope="col">{labels.completedAt}</TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.durationMs}
              </TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.requests}
              </TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.totalTokens}
              </TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.outputTokens}
              </TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.apiEquivalentUsd}
              </TableHead>
              <TableHead numeric scope="col">
                {labels.metrics.codexCredits}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(start, start + PAGE_SIZE).map(({ group, sample, key, inFirst, inSecond }, index) => {
              const [completedAt, durationMs, requests, totalTokens, outputTokens, apiUsd, credits] = sample;
              return (
                <TableRow key={key}>
                  <TableCell numeric>{numbers.format(start + index + 1)}</TableCell>
                  <TableCell>
                    {[inFirst ? labels.compareA : null, inSecond ? labels.compareB : null].filter(Boolean).join(' / ')}
                  </TableCell>
                  <TableCell className="font-mono">{group.model}</TableCell>
                  <TableCell>{labels.modes[group.serviceTier]}</TableCell>
                  <TableCell>{group.reasoningEffort ?? labels.unknownEffort}</TableCell>
                  <TableCell>{date.format(completedAt)}</TableCell>
                  <TableCell numeric>{format(durationMs === null ? null : durationMs / 1_000, numbers)}</TableCell>
                  <TableCell numeric>{format(requests, numbers)}</TableCell>
                  <TableCell numeric>{format(totalTokens, tokens)}</TableCell>
                  <TableCell numeric>{format(outputTokens, tokens)}</TableCell>
                  <TableCell numeric>{format(apiUsd, money)}</TableCell>
                  <TableCell numeric>{format(credits, numbers)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="tabular-nums">
          {numbers.format(start + 1)}–{numbers.format(Math.min(start + PAGE_SIZE, rows.length))} /{' '}
          {numbers.format(rows.length)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={labels.previousPage}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="tabular-nums">
            {numbers.format(currentPage + 1)} / {numbers.format(pageCount)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={labels.nextPage}
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
