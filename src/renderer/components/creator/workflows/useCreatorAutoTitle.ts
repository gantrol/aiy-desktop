import { useEffect, useRef, useState } from 'react';
import type { Locale, PromptSeriesDto } from '@/shared/contracts';
import { fallbackTitleSuggestion } from '@/shared/title-fallback';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export interface CreatorAutoTitleRequest {
  runId: string;
  seriesId: string;
  prompt: string;
  initialTitle: string;
}

interface Options {
  locale: Locale;
  notify(message: string): void;
  refresh(): Promise<void>;
  series: readonly PromptSeriesDto[];
  titleGeneratedMessage: string;
  titleGenerationFailedMessage: string;
}

export function useCreatorAutoTitle(options: Options) {
  const [pending, setPending] = useState<CreatorAutoTitleRequest | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const notify = useStableCallback(options.notify);
  const refresh = useStableCallback(options.refresh);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const targetSeries = options.series.find((item) => item.id === pending.seriesId);
    const targetVersion = targetSeries?.versions.find((item) => item.runs.some((run) => run.id === pending.runId));
    if (!targetVersion) return;
    const succeeded = targetVersion.runs.some((run) => run.status === 'SUCCEEDED');
    const active = targetVersion.runs.some((run) => run.status === 'QUEUED' || run.status === 'RUNNING');
    if (!succeeded && active) return;
    const request = pending;
    const operationGeneration = generationRef.current;
    setPending(null);
    if (!succeeded) return;
    const operationIsCurrent = () => mountedRef.current && generationRef.current === operationGeneration;
    const rename = async (title: string) => {
      if (!operationIsCurrent()) return;
      const result = await window.desktopApi.promptSeriesRename({
        seriesId: request.seriesId,
        title,
        locale: options.locale,
        expectedTitle: request.initialTitle,
      });
      if (!result.renamed || !operationIsCurrent()) return;
      await refresh();
      if (operationIsCurrent()) notify(options.titleGeneratedMessage);
    };
    void window.desktopApi
      .codexSuggestTitles({ prompt: request.prompt, title: '', mode: 'regenerate' })
      .then((result) =>
        rename(fallbackTitleSuggestion({ prompt: request.prompt, title: result.title, mode: 'fill' }).title),
      )
      .catch(() =>
        rename(fallbackTitleSuggestion({ prompt: request.prompt, title: '', mode: 'regenerate' }).title).catch(
          () => operationIsCurrent() && notify(options.titleGenerationFailedMessage),
        ),
      );
  }, [
    notify,
    options.locale,
    options.series,
    options.titleGeneratedMessage,
    options.titleGenerationFailedMessage,
    pending,
    refresh,
  ]);

  const scheduleAutoTitle = useStableCallback((request: CreatorAutoTitleRequest) => {
    generationRef.current += 1;
    setPending(request);
  });

  return { scheduleAutoTitle };
}
