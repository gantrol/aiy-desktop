import { useEffect, useState, type FormEvent } from 'react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import {
  DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT,
  MAX_IMAGE_GENERATION_MAX_CONCURRENT,
  MIN_IMAGE_GENERATION_MAX_CONCURRENT,
} from '@/shared/image-generation-concurrency';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  route: ImageGenerationRouteDto;
  refresh(): Promise<void>;
  notify(message: string): void;
}

export function ImageGenerationConcurrencyControl({ route, refresh, notify }: Props) {
  const l = useI18n().messages.aiCenter.capability;
  const current = route.maxConcurrent ?? DEFAULT_IMAGE_GENERATION_MAX_CONCURRENT;
  const [draft, setDraft] = useState(String(current));
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(String(current)), [current, route.key]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const maxConcurrent = Number(draft);
    if (
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < MIN_IMAGE_GENERATION_MAX_CONCURRENT ||
      maxConcurrent > MAX_IMAGE_GENERATION_MAX_CONCURRENT
    ) {
      notify(l.concurrencyInvalid(MIN_IMAGE_GENERATION_MAX_CONCURRENT, MAX_IMAGE_GENERATION_MAX_CONCURRENT));
      return;
    }
    setSaving(true);
    try {
      await window.desktopApi.imageGenerationConcurrencySave({ modelKey: route.key, maxConcurrent });
      await refresh();
      notify(l.concurrencySaved(route.name, maxConcurrent));
    } catch (error) {
      console.error('[image-generation-concurrency] failed to save model limit', error);
      notify(l.concurrencySaveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface-sunken px-2 py-1.5"
      onSubmit={save}
    >
      <Badge variant="secondary">{route.name}</Badge>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{l.parallelJobs}</span>
        <Input
          className="h-8 w-16 px-2 tabular-nums"
          type="number"
          min={MIN_IMAGE_GENERATION_MAX_CONCURRENT}
          max={MAX_IMAGE_GENERATION_MAX_CONCURRENT}
          step={1}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button type="submit" variant="ghost" size="sm" disabled={saving || Number(draft) === current}>
        {l.saveConcurrency}
      </Button>
    </form>
  );
}
