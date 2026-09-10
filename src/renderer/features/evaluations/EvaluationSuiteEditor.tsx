import { SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EvaluationSuiteContentInput, EvaluationSuiteDto, Locale } from '@/shared/contracts';
import { evaluationSuiteContentSchema } from '@/shared/contracts/evaluation-suite';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { EvaluationCasePanel } from '@/renderer/features/evaluations/EvaluationCasePanel';
import { EvaluationConditionPanel } from '@/renderer/features/evaluations/EvaluationConditionPanel';
import { EvaluationMatrixPreview } from '@/renderer/features/evaluations/EvaluationMatrixPreview';
import { EvaluationTaskLibrary } from '@/renderer/features/evaluations/EvaluationTaskLibrary';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';

interface Props {
  suite: EvaluationSuiteDto;
  locale: Locale;
  onSave(content: EvaluationSuiteContentInput): Promise<EvaluationSuiteDto>;
  notify(message: string): void;
}

type EditorTab = 'library' | 'cases' | 'conditions' | 'matrix';

export function EvaluationSuiteEditor({ suite, locale, onSave, notify }: Props) {
  const [content, setContent] = useState<EvaluationSuiteContentInput>(suite.content);
  const [baselineHash, setBaselineHash] = useState(suite.contentHash);
  const [baselineContentKey, setBaselineContentKey] = useState(() => JSON.stringify(suite.content));
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(suite.content.cases[0]?.id ?? null);
  const [selectedConditionId, setSelectedConditionId] = useState<string | null>(
    suite.content.conditions[0]?.id ?? null,
  );
  const [tab, setTab] = useState<EditorTab>('cases');
  const [saving, setSaving] = useState(false);
  const contentKey = useMemo(() => JSON.stringify(content), [content]);
  const dirty = contentKey !== baselineContentKey;
  const labels =
    locale === 'zh'
      ? {
          library: '题库',
          cases: '问题',
          conditions: '条件',
          matrix: '矩阵',
          repeats: '重复',
          save: '保存',
          saving: '保存中',
          revision: '版本',
        }
      : {
          library: 'Task bank',
          cases: 'Cases',
          conditions: 'Conditions',
          matrix: 'Matrix',
          repeats: 'Repeats',
          save: 'Save',
          saving: 'Saving',
          revision: 'Revision',
        };

  useEffect(() => {
    if (suite.contentHash === baselineHash || dirty) return;
    setContent(suite.content);
    setBaselineHash(suite.contentHash);
    setBaselineContentKey(JSON.stringify(suite.content));
    setSelectedCaseId(suite.content.cases[0]?.id ?? null);
    setSelectedConditionId(suite.content.conditions[0]?.id ?? null);
  }, [baselineHash, dirty, suite.content, suite.contentHash]);

  async function save() {
    if (saving || !dirty) return;
    const parsed = evaluationSuiteContentSchema.safeParse(content);
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? (locale === 'zh' ? '评测集内容无效' : 'Invalid evaluation suite'));
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(parsed.data);
      setContent(saved.content);
      setBaselineHash(saved.contentHash);
      setBaselineContentKey(JSON.stringify(saved.content));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Input
          value={content.title}
          className="h-8 max-w-lg border-transparent px-2 text-base font-semibold hover:border-input focus-visible:border-ring"
          aria-label={locale === 'zh' ? '评测集名称' : 'Evaluation suite name'}
          onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CreationWorkNavigation />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{labels.repeats}</span>
            <Input
              type="number"
              min={1}
              max={20}
              value={content.defaultRepeatCount}
              className="h-8 w-16 px-2 text-right tabular-nums"
              aria-label={labels.repeats}
              onChange={(event) =>
                setContent((current) => ({
                  ...current,
                  defaultRepeatCount: Math.min(20, Math.max(1, Number(event.target.value) || 1)),
                }))
              }
            />
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {labels.revision} {suite.revisionNo}
          </span>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            <SaveIcon className="size-3.5" />
            {saving ? labels.saving : labels.save}
          </Button>
        </div>
      </header>

      <Tabs value={tab} className="min-h-0 flex-1" onValueChange={(value) => setTab(value as EditorTab)}>
        <TabsList className="shrink-0 px-3">
          <TabsTrigger value="library">{labels.library}</TabsTrigger>
          <TabsTrigger value="cases">
            {labels.cases} · {content.cases.length}
          </TabsTrigger>
          <TabsTrigger value="conditions">
            {labels.conditions} · {content.conditions.length}
          </TabsTrigger>
          <TabsTrigger value="matrix">{labels.matrix}</TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="flex min-h-0 flex-1">
          <EvaluationTaskLibrary
            cases={content.cases}
            locale={locale}
            onCasesChange={(cases) => setContent((current) => ({ ...current, cases }))}
            onSelectedCaseIdChange={setSelectedCaseId}
            onOpenCases={() => setTab('cases')}
          />
        </TabsContent>
        <TabsContent value="cases" className="flex min-h-0 flex-1">
          <EvaluationCasePanel
            cases={content.cases}
            locale={locale}
            selectedCaseId={selectedCaseId}
            onCasesChange={(cases) => setContent((current) => ({ ...current, cases }))}
            onSelectedCaseIdChange={setSelectedCaseId}
          />
        </TabsContent>
        <TabsContent value="conditions" className="flex min-h-0 flex-1">
          <EvaluationConditionPanel
            conditions={content.conditions}
            locale={locale}
            selectedConditionId={selectedConditionId}
            onConditionsChange={(conditions) => setContent((current) => ({ ...current, conditions }))}
            onSelectedConditionIdChange={setSelectedConditionId}
          />
        </TabsContent>
        <TabsContent value="matrix" className="flex min-h-0 flex-1">
          <EvaluationMatrixPreview
            cases={content.cases}
            conditions={content.conditions}
            locale={locale}
            onOpenCases={() => setTab('cases')}
            onOpenConditions={() => setTab('conditions')}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
