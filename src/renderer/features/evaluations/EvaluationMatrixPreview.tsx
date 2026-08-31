import type { EvaluationCase, EvaluationTargetCondition, Locale } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';

interface Props {
  cases: readonly EvaluationCase[];
  conditions: readonly EvaluationTargetCondition[];
  locale: Locale;
  onOpenCases(): void;
  onOpenConditions(): void;
}

export function EvaluationMatrixPreview({ cases, conditions, locale, onOpenCases, onOpenConditions }: Props) {
  const activeConditions = conditions.filter((condition) => condition.enabled);
  const labels =
    locale === 'zh'
      ? { emptyCases: '暂无问题', addCases: '添加问题', emptyConditions: '暂无运行条件', addConditions: '添加条件' }
      : {
          emptyCases: 'No cases',
          addCases: 'Add cases',
          emptyConditions: 'No target conditions',
          addConditions: 'Add conditions',
        };
  if (cases.length === 0) {
    return (
      <QuietEmpty className="m-auto" title={labels.emptyCases} actionLabel={labels.addCases} onAction={onOpenCases} />
    );
  }
  if (activeConditions.length === 0) {
    return (
      <QuietEmpty
        className="m-auto"
        title={labels.emptyConditions}
        actionLabel={labels.addConditions}
        onAction={onOpenConditions}
      />
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="min-w-max p-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-64 bg-background">
                {locale === 'zh' ? '问题' : 'Case'}
              </TableHead>
              {activeConditions.map((condition) => (
                <TableHead key={condition.id} className="min-w-44">
                  <span className="block max-w-44 truncate" title={condition.name}>
                    {condition.name}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((evaluationCase, index) => (
              <TableRow key={evaluationCase.id}>
                <TableCell className="sticky left-0 z-10 bg-background">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="max-w-56 truncate">{evaluationCase.title}</span>
                  </div>
                </TableCell>
                {activeConditions.map((condition) => (
                  <TableCell key={condition.id}>
                    <Badge variant="outline">{locale === 'zh' ? '待运行' : 'Not run'}</Badge>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ScrollArea>
  );
}
