import { PlusIcon, Trash2Icon } from 'lucide-react';
import type {
  EvaluationCase,
  EvaluationCaseKind,
  EvaluationCriterion,
  EvaluationInputPart,
  EvaluationInputPartKind,
  EvaluationPreprocessing,
  Locale,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { EvaluationCriterionEditor } from '@/renderer/features/evaluations/EvaluationCriterionEditor';
import { cn } from '@/renderer/lib/utils';

interface Props {
  cases: readonly EvaluationCase[];
  locale: Locale;
  selectedCaseId: string | null;
  onCasesChange(cases: EvaluationCase[]): void;
  onSelectedCaseIdChange(id: string | null): void;
}

const caseKinds: readonly EvaluationCaseKind[] = ['MODEL_RESPONSE', 'MEDIA_CREATION', 'SOFTWARE_TASK'];
const inputKinds: readonly EvaluationInputPartKind[] = ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE'];
const preprocessingOptions: readonly EvaluationPreprocessing[] = ['NATIVE', 'TRANSCRIPT', 'KEY_FRAMES'];

function newId() {
  return window.crypto.randomUUID();
}

function caseKindLabel(kind: EvaluationCaseKind, locale: Locale) {
  const labels =
    locale === 'zh'
      ? { MODEL_RESPONSE: '问答', MEDIA_CREATION: '媒体创作', SOFTWARE_TASK: '小工具实现' }
      : { MODEL_RESPONSE: 'Response', MEDIA_CREATION: 'Media creation', SOFTWARE_TASK: 'Software task' };
  return labels[kind];
}

function inputKindLabel(kind: EvaluationInputPartKind, locale: Locale) {
  const labels =
    locale === 'zh'
      ? { TEXT: '文本', IMAGE: '图片', AUDIO: '音频', VIDEO: '视频', FILE: '文件' }
      : { TEXT: 'Text', IMAGE: 'Image', AUDIO: 'Audio', VIDEO: 'Video', FILE: 'File' };
  return labels[kind];
}

function preprocessingLabel(value: EvaluationPreprocessing, locale: Locale) {
  const labels =
    locale === 'zh'
      ? { NATIVE: '原生输入', TRANSCRIPT: '转写', KEY_FRAMES: '关键帧' }
      : { NATIVE: 'Native', TRANSCRIPT: 'Transcript', KEY_FRAMES: 'Key frames' };
  return labels[value];
}

function freshInputPart(kind: EvaluationInputPartKind, sortOrder: number, locale: Locale): EvaluationInputPart {
  const base = {
    id: newId(),
    label: inputKindLabel(kind, locale),
    sortOrder,
  };
  if (kind === 'TEXT') return { ...base, kind, text: '' };
  return {
    ...base,
    kind,
    assetId: '',
    mimeType:
      kind === 'IMAGE'
        ? 'image/png'
        : kind === 'AUDIO'
          ? 'audio/mpeg'
          : kind === 'VIDEO'
            ? 'video/mp4'
            : 'application/octet-stream',
    preprocessing: kind === 'AUDIO' ? 'TRANSCRIPT' : kind === 'VIDEO' ? 'KEY_FRAMES' : 'NATIVE',
    timeRange: null,
  };
}

function freshCase(locale: Locale): EvaluationCase {
  return {
    id: newId(),
    kind: 'MODEL_RESPONSE',
    title: locale === 'zh' ? '未命名问题' : 'Untitled case',
    inputParts: [freshInputPart('TEXT', 0, locale)],
    expected: '',
    criteria: [],
    tags: [],
  };
}

function freshCriterion(locale: Locale): EvaluationCriterion {
  return {
    id: newId(),
    label: locale === 'zh' ? '正确性' : 'Correctness',
    description: '',
    weight: 1,
    phase: 'GENERAL',
    isGate: false,
  };
}

function EvaluationInputPartEditor({
  part,
  inputCount,
  locale,
  onChange,
  onRemove,
}: {
  part: EvaluationInputPart;
  inputCount: number;
  locale: Locale;
  onChange(part: EvaluationInputPart): void;
  onRemove(): void;
}) {
  const labels =
    locale === 'zh'
      ? {
          type: '类型',
          label: '名称',
          content: '内容',
          assetId: '素材 ID',
          mimeType: 'MIME 类型',
          preprocessing: '预处理',
          delete: '删除',
        }
      : {
          type: 'Type',
          label: 'Label',
          content: 'Content',
          assetId: 'Asset ID',
          mimeType: 'MIME type',
          preprocessing: 'Preprocessing',
          delete: 'Delete',
        };
  return (
    <div className="grid gap-3 border-b pb-4 last:border-b-0">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <Select
          value={part.kind}
          onValueChange={(value) => {
            const next = freshInputPart(value as EvaluationInputPartKind, part.sortOrder, locale);
            onChange({ ...next, id: part.id, label: part.label });
          }}
        >
          <SelectTrigger aria-label={labels.type}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {inputKinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {inputKindLabel(kind, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={part.label}
          aria-label={labels.label}
          onChange={(event) => onChange({ ...part, label: event.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={inputCount === 1}
          title={labels.delete}
          onClick={onRemove}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      {part.kind === 'TEXT' ? (
        <Textarea
          value={part.text}
          rows={5}
          aria-label={labels.content}
          onChange={(event) => onChange({ ...part, text: event.target.value })}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <Input
            value={part.assetId}
            aria-label={labels.assetId}
            placeholder={labels.assetId}
            onChange={(event) => onChange({ ...part, assetId: event.target.value })}
          />
          <Input
            value={part.mimeType}
            aria-label={labels.mimeType}
            placeholder={labels.mimeType}
            onChange={(event) => onChange({ ...part, mimeType: event.target.value })}
          />
          <Select
            value={part.preprocessing}
            onValueChange={(value) => onChange({ ...part, preprocessing: value as EvaluationPreprocessing })}
          >
            <SelectTrigger aria-label={labels.preprocessing}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {preprocessingOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {preprocessingLabel(value, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function panelLabels(locale: Locale) {
  return locale === 'zh'
    ? {
        add: '新增问题',
        empty: '暂无问题',
        title: '标题',
        type: '类型',
        inputs: '输入',
        addInput: '添加输入',
        label: '名称',
        content: '内容',
        assetId: '素材 ID',
        mimeType: 'MIME 类型',
        preprocessing: '预处理',
        expected: '参考答案 / 验收目标',
        criteria: '评分标准',
        addCriterion: '添加标准',
        scoreTotal: '总分',
        weight: '权重',
        description: '标准说明',
        tags: '标签',
        delete: '删除',
      }
    : {
        add: 'Add case',
        empty: 'No cases',
        title: 'Title',
        type: 'Type',
        inputs: 'Inputs',
        addInput: 'Add input',
        label: 'Label',
        content: 'Content',
        assetId: 'Asset ID',
        mimeType: 'MIME type',
        preprocessing: 'Preprocessing',
        expected: 'Expected answer / acceptance target',
        criteria: 'Criteria',
        addCriterion: 'Add criterion',
        scoreTotal: 'Total',
        weight: 'Weight',
        description: 'Description',
        tags: 'Tags',
        delete: 'Delete',
      };
}

export function EvaluationCasePanel({ cases, locale, selectedCaseId, onCasesChange, onSelectedCaseIdChange }: Props) {
  const selected = cases.find((item) => item.id === selectedCaseId) ?? cases[0] ?? null;
  const labels = panelLabels(locale);
  const scoreTotal = selected?.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) ?? 0;

  function addCase() {
    const next = freshCase(locale);
    onCasesChange([...cases, next]);
    onSelectedCaseIdChange(next.id);
  }

  function updateSelected(transform: (value: EvaluationCase) => EvaluationCase) {
    if (!selected) return;
    onCasesChange(cases.map((item) => (item.id === selected.id ? transform(item) : item)));
  }

  function deleteSelected() {
    if (!selected) return;
    const next = cases.filter((item) => item.id !== selected.id);
    onCasesChange(next);
    onSelectedCaseIdChange(next[0]?.id ?? null);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r bg-surface-sunken">
        <div className="flex h-11 shrink-0 items-center justify-end border-b px-2">
          <Button type="button" variant="ghost" size="sm" onClick={addCase}>
            <PlusIcon className="size-3.5" />
            {labels.add}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-1.5">
            {cases.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-hover',
                  item.id === selected?.id && 'bg-selected text-selected-foreground hover:bg-selected',
                )}
                onClick={() => onSelectedCaseIdChange(item.id)}
              >
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {selected ? (
        <ScrollArea className="min-h-0">
          <div className="mx-auto grid w-full max-w-4xl gap-6 p-5 pb-12">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
              <Field>
                <FieldLabel>{labels.title}</FieldLabel>
                <FieldControl>
                  <Input
                    value={selected.title}
                    onChange={(event) => updateSelected((item) => ({ ...item, title: event.target.value }))}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{labels.type}</FieldLabel>
                <Select
                  value={selected.kind}
                  onValueChange={(value) => updateSelected((item) => ({ ...item, kind: value as EvaluationCaseKind }))}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {caseKinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {caseKindLabel(kind, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="icon" title={labels.delete} onClick={deleteSelected}>
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <strong className="text-sm font-semibold">{labels.inputs}</strong>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateSelected((item) => ({
                      ...item,
                      inputParts: [...item.inputParts, freshInputPart('TEXT', item.inputParts.length, locale)],
                    }))
                  }
                >
                  <PlusIcon className="size-3.5" />
                  {labels.addInput}
                </Button>
              </div>
              {selected.inputParts.map((part) => (
                <EvaluationInputPartEditor
                  key={part.id}
                  part={part}
                  inputCount={selected.inputParts.length}
                  locale={locale}
                  onChange={(next) =>
                    updateSelected((item) => ({
                      ...item,
                      inputParts: item.inputParts.map((value) => (value.id === part.id ? next : value)),
                    }))
                  }
                  onRemove={() =>
                    updateSelected((item) => ({
                      ...item,
                      inputParts: item.inputParts
                        .filter((value) => value.id !== part.id)
                        .map((value, sortOrder) => ({ ...value, sortOrder })),
                    }))
                  }
                />
              ))}
            </section>

            <Field>
              <FieldLabel>{labels.expected}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={selected.expected}
                  rows={5}
                  onChange={(event) => updateSelected((item) => ({ ...item, expected: event.target.value }))}
                />
              </FieldControl>
            </Field>

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <div className="flex items-center gap-3">
                  <strong className="text-sm font-semibold">{labels.criteria}</strong>
                  <span
                    className={cn(
                      'text-xs tabular-nums text-muted-foreground',
                      Math.abs(scoreTotal - 100) <= 0.001 && 'text-success',
                    )}
                  >
                    {labels.scoreTotal} · {scoreTotal}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateSelected((item) => ({ ...item, criteria: [...item.criteria, freshCriterion(locale)] }))
                  }
                >
                  <PlusIcon className="size-3.5" />
                  {labels.addCriterion}
                </Button>
              </div>
              {selected.criteria.map((criterion) => (
                <EvaluationCriterionEditor
                  key={criterion.id}
                  criterion={criterion}
                  locale={locale}
                  onChange={(next) =>
                    updateSelected((item) => ({
                      ...item,
                      criteria: item.criteria.map((value) => (value.id === criterion.id ? next : value)),
                    }))
                  }
                  onRemove={() =>
                    updateSelected((item) => ({
                      ...item,
                      criteria: item.criteria.filter((value) => value.id !== criterion.id),
                    }))
                  }
                />
              ))}
            </section>

            <Field>
              <FieldLabel>{labels.tags}</FieldLabel>
              <FieldControl>
                <Input
                  value={selected.tags.join(', ')}
                  onChange={(event) =>
                    updateSelected((item) => ({
                      ...item,
                      tags: [
                        ...new Set(
                          event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ],
                    }))
                  }
                />
              </FieldControl>
            </Field>
          </div>
        </ScrollArea>
      ) : (
        <QuietEmpty className="self-center" title={labels.empty} actionLabel={labels.add} onAction={addCase} />
      )}
    </div>
  );
}
