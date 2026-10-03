import type { CodexOutputThroughputAnalysis } from '@/shared/contracts/codex-output-throughput';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import {
  CodexOutputThroughputDetails,
  CodexOutputThroughputValue,
} from '@/renderer/features/extensions/CodexOutputThroughput';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CodexOutputThroughputComparison({
  analysis,
}: {
  analysis: CodexOutputThroughputAnalysis | null | undefined;
}) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexThroughput;
  const labels = messages.extensions.codexUsageInvestigator.modelComparison;
  const numbers = new Intl.NumberFormat(locale);
  return (
    <section className="grid min-w-0 gap-3 text-xs" aria-label={l.comparison}>
      <div className="flex flex-wrap items-center gap-3 font-medium">
        <CodexOutputThroughputValue throughput={analysis?.overall} label />
        {analysis?.truncated && <span>{labels.truncated}</span>}
      </div>
      <CodexOutputThroughputDetails throughput={analysis?.overall} />
      {Boolean(analysis?.groups.length) && (
        <div className="max-h-80 overflow-auto border-y">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>{labels.model}</TableHead>
                <TableHead>{labels.effort}</TableHead>
                <TableHead>{labels.mode}</TableHead>
                <TableHead numeric>
                  {l.turn} ({l.unit})
                </TableHead>
                <TableHead numeric>{l.coverage}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis?.groups.map((group) => (
                <TableRow key={JSON.stringify([group.model, group.reasoningEffort, group.serviceTier])}>
                  <TableCell className="font-mono">{group.model ?? l.unknownModel}</TableCell>
                  <TableCell>{group.reasoningEffort ?? labels.unknownEffort}</TableCell>
                  <TableCell>{labels.modes[group.serviceTier]}</TableCell>
                  <TableCell numeric>
                    <CodexOutputThroughputValue throughput={group.throughput} />
                  </TableCell>
                  <TableCell numeric>
                    {numbers.format(group.throughput.pairedTurnCount)} /{' '}
                    {numbers.format(group.throughput.completedTurnCount + group.throughput.abortedTurnCount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
