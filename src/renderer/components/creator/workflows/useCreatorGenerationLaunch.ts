import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type {
  GenerationQuality,
  GenerationTargetInput,
  ImageEditBatchStartInput,
  Locale,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import type { ResolvedPromptComposition } from '@/shared/prompt-composition';
import { useEffect, useRef, useState } from 'react';

interface GenerationBatchResult {
  batchId: string | null;
  runIds: string[];
  seriesId: string;
  versionId: string;
}

export interface CreatorGenerationLaunchSnapshot {
  annotationRefinement: AnnotationRefinementState | null;
  automaticChangeSummary: string;
  baseVersionId: string | null;
  canvas: { height: number | null; stableKey: string | null; width: number | null };
  creating: boolean;
  finalPrompt: string;
  generationTargets: GenerationTargetInput[];
  initialTitle: string;
  inspirationStashId: string | null;
  keepEditorOpen: boolean;
  locale: Locale;
  prompt: CreationDraftPromptSnapshot;
  quality: GenerationQuality;
  ready: boolean;
  referenceAssetIds: string[];
  resolvedPrompt: ResolvedPromptComposition;
  seriesId: string | null;
  termPromptLocale: Locale;
  typedTitle: string;
  wordPaletteReferences: WordPaletteReferenceInput[];
}

interface Options {
  active: boolean;
  blocked(): boolean;
  captureSnapshot(): CreatorGenerationLaunchSnapshot;
  preserveWorkingInput(): Promise<boolean>;
  failedMessage: string;
  invalidateAutosaves(): void;
  notify(message: string): void;
  onGenerated(result: GenerationBatchResult, snapshot: CreatorGenerationLaunchSnapshot): void;
  onRefinementGenerated(result: GenerationBatchResult): void;
  refresh(): Promise<void>;
  requestIdentity: string;
  saveDraft(prompt: CreationDraftPromptSnapshot): Promise<{ id: string }>;
  startedMessage: string;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useCreatorGenerationLaunch(options: Options) {
  const [starting, setStarting] = useState(false);
  const inFlightRef = useRef(false);
  const operationRevisionRef = useRef(0);
  const captureSnapshot = useStableCallback(options.captureSnapshot);
  const blocked = useStableCallback(options.blocked);
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const invalidateAutosaves = useStableCallback(options.invalidateAutosaves);
  const notify = useStableCallback(options.notify);
  const onGenerated = useStableCallback(options.onGenerated);
  const onRefinementGenerated = useStableCallback(options.onRefinementGenerated);
  const refresh = useStableCallback(options.refresh);
  const saveDraft = useStableCallback(options.saveDraft);
  const preserveWorkingInput = useStableCallback(options.preserveWorkingInput);

  useEffect(() => {
    operationRevisionRef.current += 1;
    inFlightRef.current = false;
    setStarting(false);
  }, [options.requestIdentity]);

  const generate = useStableCallback(async () => {
    if (inFlightRef.current || blocked()) return;
    let snapshot: CreatorGenerationLaunchSnapshot;
    try {
      snapshot = captureSnapshot();
    } catch (reason) {
      notify(messageFor(reason));
      return;
    }
    if (!snapshot.ready || (!snapshot.prompt.manualPrompt.trim() && !snapshot.finalPrompt.trim())) return;
    const requestIdentity = getRequestIdentity();
    const operationRevision = ++operationRevisionRef.current;
    const requestIsCurrent = () =>
      operationRevisionRef.current === operationRevision && getRequestIdentity() === requestIdentity;
    inFlightRef.current = true;
    setStarting(true);
    try {
      if (!(await preserveWorkingInput()) || !requestIsCurrent()) return;
      if (snapshot.annotationRefinement) {
        const refinement = snapshot.annotationRefinement;
        const result = await window.desktopApi.imageEditStartBatch({
          seriesId: refinement.sourceSeriesId,
          sourceAssetId: refinement.sourceAssetId,
          annotationIds: refinement.annotations.map((annotation) => annotation.id),
          targets: snapshot.generationTargets.map((target) => ({ ...target })),
          mode: 'SEMANTIC',
          locale: snapshot.locale,
        } satisfies ImageEditBatchStartInput);
        await refresh();
        if (!requestIsCurrent()) return;
        onRefinementGenerated(result);
        notify(`${options.startedMessage} · ${result.runIds.length}`);
        return;
      }
      invalidateAutosaves();
      const creationDraftId = snapshot.creating ? (await saveDraft(snapshot.prompt)).id : null;
      if (!requestIsCurrent()) return;
      const result = await window.desktopApi.generationStartBatch({
        input: {
          seriesId: snapshot.creating ? null : snapshot.seriesId,
          creationDraftId,
          inspirationStashId: snapshot.inspirationStashId,
          baseVersionId: snapshot.creating ? null : snapshot.baseVersionId,
          title: snapshot.initialTitle,
          titleLocale: snapshot.locale,
          manualPrompt: snapshot.prompt.manualPrompt,
          promptNodes: snapshot.prompt.nodes,
          document: snapshot.prompt.document,
          prompt: snapshot.finalPrompt,
          resolvedPrompt: snapshot.resolvedPrompt,
          changeSummary: snapshot.automaticChangeSummary,
          referenceAssetIds: snapshot.referenceAssetIds,
          termPromptLocale: snapshot.termPromptLocale,
          termIds: snapshot.prompt.selectedTerms.map((term) => term.id),
          wordPaletteReferences: snapshot.wordPaletteReferences,
          canvasPresetKey: snapshot.canvas.stableKey,
          width: snapshot.canvas.width,
          height: snapshot.canvas.height,
          quality: snapshot.quality,
        },
        targets: snapshot.generationTargets.map((target) => ({ ...target })),
      });
      if (!(await preserveWorkingInput()) || !requestIsCurrent()) {
        await refresh();
        return;
      }
      await refresh();
      if (!requestIsCurrent()) return;
      onGenerated(result, snapshot);
      notify(`${options.startedMessage} · ${result.runIds.length}`);
    } catch (reason) {
      if (requestIsCurrent()) notify(`${options.failedMessage}: ${messageFor(reason)}`);
    } finally {
      if (operationRevisionRef.current === operationRevision) {
        inFlightRef.current = false;
        setStarting(false);
      }
    }
  });

  useEffect(() => {
    if (!options.active) return;
    function submitOnShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key !== 'Enter') return;
      if (!(event.target instanceof Element) || !event.target.closest('[data-generation-prompt="true"]')) return;
      event.preventDefault();
      void generate();
    }
    window.addEventListener('keydown', submitOnShortcut);
    return () => window.removeEventListener('keydown', submitOnShortcut);
  }, [generate, options.active]);

  return { generate, starting };
}
