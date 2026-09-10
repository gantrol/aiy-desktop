import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  codexContentModelSchema,
  type CodexContentExecution,
  type CodexContentModel,
} from '@/shared/contracts/codex-content';

export function CodexExecutionPicker({
  value,
  disabled,
  onChange,
  onError,
}: {
  value: CodexContentExecution;
  disabled: boolean;
  onChange(value: CodexContentExecution): Promise<void>;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.codex;
  const modelId = useId();
  const effortId = useId();
  const [models, setModels] = useState<CodexContentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void window.desktopPetals.codex
      .command({ kind: 'models' })
      .then((result) => {
        if (live) setModels(z.array(codexContentModelSchema).parse(result));
      })
      .catch((reason) => {
        if (live) onError(reason);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [version, onError]);
  const model = models.find((item) => item.key === value.model);
  return (
    <div className="grid min-w-0 gap-3" aria-busy={loading}>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-h-5 items-center justify-between">
          <Label htmlFor={modelId} className="text-2xs text-muted-foreground">
            {copy.model}
          </Label>
          <Button
            variant="ghost"
            size="xs"
            className="-my-1 size-6 rounded-sm p-0 text-muted-foreground"
            disabled={disabled || loading}
            title={copy.refresh}
            aria-label={copy.refresh}
            onClick={() => setVersion((current) => current + 1)}
          >
            <RefreshCw className={`size-3${loading ? ' motion-safe:animate-spin' : ''}`} />
          </Button>
        </div>
        <Select
          value={value.model ?? '_default'}
          disabled={disabled || loading}
          onValueChange={(model) =>
            void onChange({ model: model === '_default' ? null : model, effort: null }).catch(onError)
          }
        >
          <SelectTrigger id={modelId} className="h-8 w-full rounded-sm text-xs" aria-label={copy.model}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            collisionPadding={12}
            className="max-h-[min(14rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-24px)]"
          >
            <SelectItem value="_default">{copy.providerDefault}</SelectItem>
            {value.model && !model && (
              <SelectItem value={value.model} disabled>
                {value.model}
              </SelectItem>
            )}
            {models.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={effortId} className="text-2xs text-muted-foreground">
          {copy.effort}
        </Label>
        <Select
          value={value.effort ?? '_default'}
          disabled={disabled || loading || !model}
          onValueChange={(effort) => {
            const selected = model?.supportedReasoningEfforts.find((item) => item === effort) ?? null;
            void onChange({ model: value.model, effort: selected }).catch(onError);
          }}
        >
          <SelectTrigger id={effortId} className="h-8 w-full rounded-sm text-xs" aria-label={copy.effort}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            collisionPadding={12}
            className="max-h-[min(14rem,var(--radix-select-content-available-height))]"
          >
            <SelectItem value="_default">{value.model ? copy.modelDefault : copy.providerDefault}</SelectItem>
            {model?.supportedReasoningEfforts.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {copy.efforts[effort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
