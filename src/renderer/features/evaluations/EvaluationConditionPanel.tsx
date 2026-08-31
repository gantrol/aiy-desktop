import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { EvaluationTargetCondition, EvaluationTargetType, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { cn } from '@/renderer/lib/utils';

interface Props {
  conditions: readonly EvaluationTargetCondition[];
  locale: Locale;
  selectedConditionId: string | null;
  onConditionsChange(conditions: EvaluationTargetCondition[]): void;
  onSelectedConditionIdChange(id: string | null): void;
}

const targetTypes: readonly EvaluationTargetType[] = ['MODEL_API', 'CHAT_IMPORT', 'AGENT_RUNTIME'];

function newId() {
  return window.crypto.randomUUID();
}

function targetTypeLabel(type: EvaluationTargetType, locale: Locale) {
  const labels =
    locale === 'zh'
      ? { MODEL_API: '模型 API', CHAT_IMPORT: '聊天结果导入', AGENT_RUNTIME: '智能体运行' }
      : { MODEL_API: 'Model API', CHAT_IMPORT: 'Chat import', AGENT_RUNTIME: 'Agent runtime' };
  return labels[type];
}

function freshCondition(locale: Locale): EvaluationTargetCondition {
  return {
    id: newId(),
    name: locale === 'zh' ? '未命名条件' : 'Untitled condition',
    type: 'MODEL_API',
    providerKey: null,
    modelKey: null,
    systemPrompt: '',
    preferenceProfile: '',
    temperature: null,
    enabled: true,
  };
}

export function EvaluationConditionPanel({
  conditions,
  locale,
  selectedConditionId,
  onConditionsChange,
  onSelectedConditionIdChange,
}: Props) {
  const selected = conditions.find((item) => item.id === selectedConditionId) ?? conditions[0] ?? null;
  const labels =
    locale === 'zh'
      ? {
          add: '新增条件',
          empty: '暂无运行条件',
          name: '名称',
          type: '接入方式',
          provider: '供应商',
          model: '模型',
          systemPrompt: '系统提示词',
          preference: '偏好配置',
          temperature: 'Temperature',
          enabled: '参与运行',
          delete: '删除',
        }
      : {
          add: 'Add condition',
          empty: 'No target conditions',
          name: 'Name',
          type: 'Connection',
          provider: 'Provider',
          model: 'Model',
          systemPrompt: 'System prompt',
          preference: 'Preference profile',
          temperature: 'Temperature',
          enabled: 'Include in runs',
          delete: 'Delete',
        };

  function addCondition() {
    const next = freshCondition(locale);
    onConditionsChange([...conditions, next]);
    onSelectedConditionIdChange(next.id);
  }

  function updateSelected(transform: (value: EvaluationTargetCondition) => EvaluationTargetCondition) {
    if (!selected) return;
    onConditionsChange(conditions.map((item) => (item.id === selected.id ? transform(item) : item)));
  }

  function deleteSelected() {
    if (!selected) return;
    const next = conditions.filter((item) => item.id !== selected.id);
    onConditionsChange(next);
    onSelectedConditionIdChange(next[0]?.id ?? null);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r bg-surface-sunken">
        <div className="flex h-11 shrink-0 items-center justify-end border-b px-2">
          <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
            <PlusIcon className="size-3.5" />
            {labels.add}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-1.5">
            {conditions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-hover',
                  item.id === selected?.id && 'bg-selected text-selected-foreground hover:bg-selected',
                )}
                onClick={() => onSelectedConditionIdChange(item.id)}
              >
                <span
                  className={cn('size-1.5 shrink-0 rounded-full bg-muted-foreground', item.enabled && 'bg-success')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {selected ? (
        <ScrollArea className="min-h-0">
          <div className="mx-auto grid w-full max-w-3xl gap-5 p-5 pb-12">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
              <Field>
                <FieldLabel>{labels.name}</FieldLabel>
                <FieldControl>
                  <Input
                    value={selected.name}
                    onChange={(event) => updateSelected((item) => ({ ...item, name: event.target.value }))}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{labels.type}</FieldLabel>
                <Select
                  value={selected.type}
                  onValueChange={(value) =>
                    updateSelected((item) => ({ ...item, type: value as EvaluationTargetType }))
                  }
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {targetTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {targetTypeLabel(type, locale)}
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>{labels.provider}</FieldLabel>
                <FieldControl>
                  <Input
                    value={selected.providerKey ?? ''}
                    onChange={(event) =>
                      updateSelected((item) => ({ ...item, providerKey: event.target.value.trim() || null }))
                    }
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{labels.model}</FieldLabel>
                <FieldControl>
                  <Input
                    value={selected.modelKey ?? ''}
                    onChange={(event) =>
                      updateSelected((item) => ({ ...item, modelKey: event.target.value.trim() || null }))
                    }
                  />
                </FieldControl>
              </Field>
            </div>

            <Field>
              <FieldLabel>{labels.systemPrompt}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={selected.systemPrompt}
                  rows={5}
                  onChange={(event) => updateSelected((item) => ({ ...item, systemPrompt: event.target.value }))}
                />
              </FieldControl>
            </Field>

            <Field>
              <FieldLabel>{labels.preference}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={selected.preferenceProfile}
                  rows={5}
                  onChange={(event) => updateSelected((item) => ({ ...item, preferenceProfile: event.target.value }))}
                />
              </FieldControl>
            </Field>

            <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
              <Field>
                <FieldLabel>{labels.temperature}</FieldLabel>
                <FieldControl>
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step="0.1"
                    value={selected.temperature ?? ''}
                    onChange={(event) =>
                      updateSelected((item) => ({
                        ...item,
                        temperature: event.target.value === '' ? null : Number(event.target.value),
                      }))
                    }
                  />
                </FieldControl>
              </Field>
              <Label className="h-9 cursor-pointer justify-start">
                <Checkbox
                  checked={selected.enabled}
                  onCheckedChange={(checked) => updateSelected((item) => ({ ...item, enabled: checked === true }))}
                />
                {labels.enabled}
              </Label>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <QuietEmpty className="self-center" title={labels.empty} actionLabel={labels.add} onAction={addCondition} />
      )}
    </div>
  );
}
