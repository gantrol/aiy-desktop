import { useEffect, useRef } from 'react';
import type {
  GenerationInput,
  GenerationTargetInput,
  GenerationVersionInput,
  ImageCropInput,
  ImageEditBatchStartInput,
  ImageReframeStartInput,
  ImageTransformOutputDto,
  Locale,
} from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  generationTargets: readonly GenerationTargetInput[];
  locale: Locale;
  notify(message: string): void;
  onOutputSeries(seriesId: string): void;
  refresh(): Promise<void>;
  requestIdentity: string;
  startedMessage: string;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useCreatorOutputCommands(options: Options) {
  const pendingRef = useRef(new Set<string>());
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const notify = useStableCallback(options.notify);
  const onOutputSeries = useStableCallback(options.onOutputSeries);
  const refresh = useStableCallback(options.refresh);

  useEffect(
    () => () => {
      pendingRef.current.clear();
    },
    [],
  );

  const cancel = useStableCallback(async (runId: string) => {
    const key = `cancel:${runId}`;
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    try {
      await window.desktopApi.generationCancel(runId);
      await refresh();
    } catch (reason) {
      notify(messageFor(reason));
    } finally {
      pendingRef.current.delete(key);
    }
  });

  const retry = useStableCallback(async (runId: string) => {
    const key = `retry:${runId}`;
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    const requestIdentity = getRequestIdentity();
    try {
      const result = await window.desktopApi.generationRetry(runId);
      await refresh();
      if (getRequestIdentity() === requestIdentity) notify(`${options.startedMessage} · ${result.runId.slice(-6)}`);
    } catch (reason) {
      if (getRequestIdentity() === requestIdentity) notify(messageFor(reason));
    } finally {
      pendingRef.current.delete(key);
    }
  });

  const refine = useStableCallback(async (input: Omit<ImageEditBatchStartInput, 'locale'>) => {
    const requestIdentity = getRequestIdentity();
    const result = await window.desktopApi.imageEditStartBatch({ ...input, locale: options.locale });
    await refresh();
    if (getRequestIdentity() === requestIdentity) onOutputSeries(result.seriesId);
  });

  const crop = useStableCallback(async (input: ImageCropInput): Promise<ImageTransformOutputDto> => {
    const requestIdentity = getRequestIdentity();
    const output = await window.desktopApi.imageCrop(input);
    await refresh();
    if (getRequestIdentity() === requestIdentity) onOutputSeries(output.seriesId);
    return output;
  });

  const reframe = useStableCallback(async (input: Omit<ImageReframeStartInput, 'locale' | 'quality'>) => {
    const requestIdentity = getRequestIdentity();
    const quality = options.generationTargets.find((target) => target.modelKey === input.modelKey)?.quality ?? 'medium';
    const result = await window.desktopApi.imageReframeStart({ ...input, locale: options.locale, quality });
    await refresh();
    if (getRequestIdentity() === requestIdentity) onOutputSeries(result.seriesId);
  });

  const generateVersion = useStableCallback(async (input: GenerationVersionInput) => {
    const requestIdentity = getRequestIdentity();
    const result = await window.desktopApi.generationStartVersion(input);
    await refresh();
    if (getRequestIdentity() === requestIdentity) notify(`${options.startedMessage} · ${result.runId.slice(-6)}`);
  });

  const generateImportedPrompt = useStableCallback(async (input: GenerationInput) => {
    const requestIdentity = getRequestIdentity();
    const result = await window.desktopApi.generationStart(input);
    await refresh();
    if (getRequestIdentity() === requestIdentity) notify(`${options.startedMessage} · ${result.runId.slice(-6)}`);
  });

  return { cancel, crop, generateImportedPrompt, generateVersion, refine, reframe, retry };
}
