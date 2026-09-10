import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { AssetDto, Locale, PromptSeriesDto, PromptVersionCreateResult } from '@/shared/contracts';
import { useEffect, useRef, useState } from 'react';

interface Options {
  automaticChangeSummary: string;
  baseVersionId: string | null;
  capturePrompt(): CreationDraftPromptSnapshot;
  preserveWorkingInput(): Promise<boolean>;
  creatingBlocked: boolean;
  locale: Locale;
  notify(message: string): void;
  promptProfileId: string;
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  requestIdentity: string;
  series: PromptSeriesDto | null;
  setOutputSeriesId(seriesId: string): void;
  setVersionId(versionId: string): void;
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  termPromptLocale: Locale;
  unavailableMessage: string;
  restartRequiredMessage: string;
  versionCreatedMessage: string;
}

export function useCreatorPromptVersionCreation(options: Options) {
  const [creating, setCreating] = useState(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const requestIdentityRef = useRef(options.requestIdentity);
  requestIdentityRef.current = options.requestIdentity;
  const capturePrompt = useStableCallback(options.capturePrompt);
  const notify = useStableCallback(options.notify);
  const refresh = useStableCallback(options.refresh);
  const setOutputSeriesId = useStableCallback(options.setOutputSeriesId);
  const setVersionId = useStableCallback(options.setVersionId);
  const synchronizePrompt = useStableCallback(options.synchronizePrompt);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const create = useStableCallback(async (targetSeriesId: string): Promise<PromptVersionCreateResult | null> => {
    const series = options.series;
    if (!series || series.id !== targetSeriesId) {
      notify(options.unavailableMessage);
      return null;
    }
    if (options.creatingBlocked || creating) return null;
    if (typeof window.desktopApi.promptVersionCreate !== 'function') {
      notify(options.restartRequiredMessage);
      return null;
    }
    let prompt: CreationDraftPromptSnapshot;
    try {
      prompt = capturePrompt();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
    const identity = requestIdentityRef.current;
    const operationGeneration = ++generationRef.current;
    const operationIsCurrent = () =>
      mountedRef.current && generationRef.current === operationGeneration && requestIdentityRef.current === identity;
    const resolution = resolveCreatorPrompt({
      manualPrompt: prompt.manualPrompt,
      promptNodes: prompt.nodes,
      selectedTerms: prompt.selectedTerms,
      appliedPalettes: prompt.appliedPalettes,
      termPromptLocale: options.termPromptLocale,
      promptProfileId: options.promptProfileId,
    });
    const nextVersionNo = Math.max(0, ...series.versions.map((item) => item.versionNo)) + 1;
    const nextVersionLabel = `V${String(nextVersionNo).padStart(2, '0')}`;
    synchronizePrompt(prompt);
    setCreating(true);
    try {
      if (!(await options.preserveWorkingInput()) || !operationIsCurrent()) return null;
      const result = await window.desktopApi.promptVersionCreate({
        seriesId: series.id,
        baseVersionId: options.baseVersionId,
        title: series.title,
        titleLocale: options.locale,
        manualPrompt: prompt.manualPrompt,
        promptNodes: prompt.nodes,
        document: prompt.document,
        prompt: resolution.livePrompt,
        changeSummary: options.automaticChangeSummary,
        referenceAssetIds: options.referenceAssets.map((asset) => asset.id),
        termPromptLocale: options.termPromptLocale,
        termIds: prompt.selectedTerms.map((term) => term.id),
        wordPaletteReferences: prompt.appliedPalettes.map((reference) => ({
          paletteId: reference.palette.id,
          paletteRevisionId: reference.revision.id,
          parameterValues: reference.parameterValues,
          promptLocale: reference.promptLocale,
        })),
      });
      if (!(await options.preserveWorkingInput()) || !operationIsCurrent()) return null;
      await refresh();
      if (!operationIsCurrent()) return null;
      setVersionId(result.versionId);
      setOutputSeriesId(result.seriesId);
      notify(`${nextVersionLabel} · ${options.versionCreatedMessage}`);
      return result;
    } catch (reason) {
      if (operationIsCurrent()) notify(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      if (operationIsCurrent()) setCreating(false);
    }
  });

  return { create, creating };
}
