import { useEffect, useRef, useState } from 'react';
import type {
  AssistantProposalAdoptionInput,
  AssistantProposalApplyValue,
  AssistantRunDto,
  Locale,
} from '@/shared/contracts';
import {
  prepareAssistantPromptAdoption,
  type AssistantPromptAdoptionFailure,
  type AssistantPromptAdoptionSource,
} from '@/renderer/components/creator/assistantPromptAdoption';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  captureSource(): AssistantPromptAdoptionSource;
  locale: Locale;
  notify(message: string): void;
  onApplyPrompt(prompt: CreationDraftPromptSnapshot): void;
  onPersistenceCommitted(persistence: NonNullable<AssistantProposalAdoptionInput['persistence']>): Promise<void>;
  onRunAdopted(run: AssistantRunDto): void;
  preparePersistence(persistence: NonNullable<AssistantPromptAdoptionSource['persistence']>): Promise<void>;
  refresh(): Promise<void>;
  successMessage: string;
}

function failureMessage(reason: AssistantPromptAdoptionFailure, locale: Locale) {
  if (reason === 'MATERIAL_REVISION_CHANGED') {
    return locale === 'zh'
      ? 'Prompt 草稿引用的词条或配方已变化，请重新整理'
      : 'A draft term or recipe changed. Organize the Prompt again.';
  }
  if (reason === 'CONTEXT_CHANGED' || reason === 'SCOPE_CHANGED') {
    return locale === 'zh'
      ? '当前创作输入已变化，请重新使用“AI帮写”'
      : 'The creation input changed. Organize the Prompt again.';
  }
  return null;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useAssistantPromptAdoption(options: Options) {
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const captureSource = useStableCallback(options.captureSource);
  const notify = useStableCallback(options.notify);
  const onApplyPrompt = useStableCallback(options.onApplyPrompt);
  const onPersistenceCommitted = useStableCallback(options.onPersistenceCommitted);
  const onRunAdopted = useStableCallback(options.onRunAdopted);
  const preparePersistence = useStableCallback(options.preparePersistence);
  const refresh = useStableCallback(options.refresh);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const adopt = useStableCallback(async (run: AssistantRunDto, value: AssistantProposalApplyValue) => {
    if (inFlightRef.current) return false;
    let source: AssistantPromptAdoptionSource;
    try {
      source = captureSource();
    } catch (reason) {
      notify(messageFor(reason));
      return false;
    }
    const preparation = prepareAssistantPromptAdoption(run, value, source);
    if (!preparation.ok) {
      const message = failureMessage(preparation.reason, options.locale);
      if (message) notify(message);
      return false;
    }
    inFlightRef.current = true;
    setBusy(true);
    try {
      await preparePersistence(source.persistence!);
      if (!mountedRef.current) return false;
      let readyPreparation;
      try {
        readyPreparation = prepareAssistantPromptAdoption(run, value, captureSource());
      } catch {
        readyPreparation = null;
      }
      if (!readyPreparation?.ok || readyPreparation.identity !== preparation.identity) {
        const message = failureMessage('CONTEXT_CHANGED', options.locale);
        if (message) notify(message);
        return false;
      }
      const adopted = await window.desktopApi.assistantProposalAdopt(readyPreparation.input);
      await onPersistenceCommitted(readyPreparation.input.persistence!);
      if (!mountedRef.current) return true;
      onRunAdopted(adopted);
      let currentPreparation;
      try {
        currentPreparation = prepareAssistantPromptAdoption(run, value, captureSource());
      } catch {
        currentPreparation = null;
      }
      if (currentPreparation?.ok && currentPreparation.identity === preparation.identity) {
        onApplyPrompt(readyPreparation.prompt);
        notify(options.successMessage);
      } else {
        notify(
          options.locale === 'zh'
            ? '提案已保存到原创作，但当前输入已变化，因此没有覆盖当前 Prompt'
            : 'The proposal was saved to its original creation; the changed current Prompt was preserved.',
        );
      }
      void refresh().catch(() => undefined);
      return true;
    } catch (reason) {
      if (mountedRef.current) notify(messageFor(reason));
      return false;
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  });

  return { adopt, busy };
}
