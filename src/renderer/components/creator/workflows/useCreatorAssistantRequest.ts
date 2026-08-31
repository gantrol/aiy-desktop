import { useEffect, useRef, useState } from 'react';
import type {
  AssistantActivityEventDto,
  AssistantRunDto,
  AssistantWebSearchMode,
  AssetDto,
  CreationDictionaryScopeDto,
  CreatorAgentAssistInput,
  CreatorAgentScope,
  CreatorPromptNodeInput,
  GenerationTargetInput,
  Locale,
  TermListItem,
} from '@/shared/contracts';
import { termFacetValueIds } from '@/shared/term-localization';
import { assistantRunHistory, directionCoverageMemory } from '@/renderer/components/creator/assistantRunHistory';
import {
  buildCreatorAssistPromptNodes,
  rankPromptDraftTermCandidates,
} from '@/renderer/components/creator/promptDraftCandidates';
import {
  buildCreatorAssistContext,
  creatorAssistantTermInput,
  type AppliedWordPalette,
  type CreatorPromptResolution,
} from '@/renderer/components/creator/utils';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type AssistantRequestMode = 'directions' | 'optimize';

interface Options {
  allRuns: readonly AssistantRunDto[];
  appliedPalettes: readonly AppliedWordPalette[];
  assistantContextKey: string;
  assistantScope: CreatorAgentScope | null;
  canvasHeight: number | null;
  canvasPresetKey: string | null;
  canvasWidth: number | null;
  configurationRequiredMessage: string;
  dictionaryPackReleaseIds: readonly string[];
  dictionaryScope: CreationDictionaryScopeDto;
  ensureScope(): Promise<CreatorAgentScope>;
  generationTargets: readonly GenerationTargetInput[];
  initialRun: AssistantRunDto | null;
  locale: Locale;
  manualPrompt: string;
  notify(message: string): void;
  onDirectionsCreated(run: AssistantRunDto): void;
  onDismissed(runId: string): void;
  onRun(run: AssistantRunDto): void;
  promptNodes: readonly CreatorPromptNodeInput[];
  promptProfileId: string;
  promptResolution: CreatorPromptResolution;
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  requestIdentity: string;
  selectedTerms: readonly TermListItem[];
  termPromptLocale: Locale;
  terms: readonly TermListItem[];
}

interface RequestSnapshot {
  allTerms: readonly TermListItem[];
  assistContext: ReturnType<typeof buildCreatorAssistContext>;
  assistantContextKey: string;
  candidateSearch: {
    includeLocalTerms: boolean;
    packReleaseIds: readonly string[];
    selectedScope: boolean;
  };
  canvasHeight: number | null;
  canvasPresetKey: string | null;
  canvasWidth: number | null;
  contentNodes: ReturnType<typeof buildCreatorAssistPromptNodes>;
  excludedTermIds: readonly string[];
  generationTargets: readonly GenerationTargetInput[];
  hasPromptContent: boolean;
  locale: Locale;
  manualPrompt: string;
  previousDirectionCoverage: ReturnType<typeof directionCoverageMemory>;
  promptProfileId: string;
  referenceAssets: CreatorAgentAssistInput['referenceAssets'];
  selectedFacetValueIds: readonly string[];
  selectedTermIds: readonly string[];
  signalTexts: readonly string[];
  termPromptLocale: Locale;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useCreatorAssistantRequest(options: Options) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AssistantRequestMode | null>(null);
  const [progressEvents, setProgressEvents] = useState<AssistantActivityEventDto[]>(
    options.initialRun?.activityEvents ?? [],
  );
  const busyRef = useRef(false);
  const requestRevisionRef = useRef(0);
  const ensureScope = useStableCallback(options.ensureScope);
  const getRequestIdentity = useStableCallback(() => options.requestIdentity);
  const notify = useStableCallback(options.notify);
  const onDirectionsCreated = useStableCallback(options.onDirectionsCreated);
  const onDismissed = useStableCallback(options.onDismissed);
  const onRun = useStableCallback(options.onRun);
  const refresh = useStableCallback(options.refresh);
  const captureSnapshot = useStableCallback((): RequestSnapshot => {
    const assistContext = buildCreatorAssistContext(options.promptResolution, options.selectedTerms, options.locale);
    return {
      allTerms: [...options.terms],
      assistContext,
      assistantContextKey: options.assistantContextKey,
      candidateSearch: {
        includeLocalTerms: options.dictionaryScope.includeLocalTerms,
        packReleaseIds: [...options.dictionaryPackReleaseIds],
        selectedScope: options.dictionaryScope.mode === 'SELECTED',
      },
      canvasHeight: options.canvasHeight,
      canvasPresetKey: options.canvasPresetKey,
      canvasWidth: options.canvasWidth,
      contentNodes: buildCreatorAssistPromptNodes(options.promptNodes, options.selectedTerms, options.appliedPalettes),
      excludedTermIds: assistContext.recipes.flatMap((recipe) => recipe.internalTerms.map((term) => term.stableId)),
      generationTargets: options.generationTargets.map((target) => ({ ...target })),
      hasPromptContent: options.promptNodes.some((node) => node.kind !== 'TEXT' || Boolean(node.text.trim())),
      locale: options.locale,
      manualPrompt: options.manualPrompt,
      previousDirectionCoverage: directionCoverageMemory(
        options.assistantScope
          ? assistantRunHistory({
              runs: options.allRuns,
              scope: options.assistantScope,
              currentContextKey: options.assistantContextKey,
            })
          : [],
        options.assistantContextKey,
      ),
      promptProfileId: options.promptProfileId,
      referenceAssets: options.referenceAssets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        ...(asset.originType ? { originType: asset.originType } : {}),
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
      })),
      selectedFacetValueIds: options.selectedTerms.flatMap(termFacetValueIds),
      selectedTermIds: options.selectedTerms.map((term) => term.id),
      signalTexts: [
        options.manualPrompt,
        ...assistContext.directTerms.flatMap((term) => [term.displayName, term.promptFragment]),
        ...assistContext.recipes.flatMap((recipe) => [
          recipe.displayName,
          recipe.promptFragment,
          ...recipe.internalTerms.flatMap((term) => [term.displayName, term.promptFragment]),
        ]),
      ],
      termPromptLocale: options.termPromptLocale,
    };
  });

  useEffect(() => {
    requestRevisionRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMode(null);
  }, [options.requestIdentity]);

  useEffect(
    () =>
      window.desktopApi.onAssistantProgress((event) => {
        if (event.contextKey !== options.assistantContextKey) return;
        setProgressEvents((current) => {
          const sameCreation = current.length === 0 || current[0]?.creationId === event.creationId;
          const base = sameCreation ? current : [];
          if (base.some((item) => item.id === event.id)) return base;
          return [...base, event].sort((left, right) => left.sequence - right.sequence);
        });
      }),
    [options.assistantContextKey],
  );

  const reset = useStableCallback(() => {
    requestRevisionRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMode(null);
    setError('');
    setProgressEvents([]);
  });

  const restore = useStableCallback((run: AssistantRunDto | null) => {
    requestRevisionRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMode(null);
    setError('');
    setProgressEvents(run?.activityEvents ?? []);
  });

  const clearError = useStableCallback(() => setError(''));
  const reportError = useStableCallback((message: string) => setError(message));

  const dismiss = useStableCallback(async (run: AssistantRunDto) => {
    onDismissed(run.id);
    setError('');
    if (run.status === 'RUNNING') return;
    try {
      if (run.proposal && run.proposal.status !== 'CLOSED') {
        await window.desktopApi.assistantProposalClose(run.id);
      } else {
        await window.desktopApi.assistantRunDismiss(run.id);
      }
      await refresh();
    } catch (reason) {
      notify(errorMessage(reason));
    }
  });

  const request = useStableCallback(
    async (
      requestMode: AssistantRequestMode,
      creationId?: string,
      webSearchMode: AssistantWebSearchMode = 'DISABLED',
    ) => {
      const snapshot = captureSnapshot();
      if (busyRef.current) return;
      if (requestMode === 'optimize' && !snapshot.hasPromptContent) return;
      const requestIdentity = getRequestIdentity();
      const requestRevision = ++requestRevisionRef.current;
      const requestIsCurrent = () =>
        requestRevisionRef.current === requestRevision && getRequestIdentity() === requestIdentity;
      busyRef.current = true;
      setBusy(true);
      setMode(requestMode);
      setError('');
      setProgressEvents([]);
      try {
        const scope = await ensureScope();
        if (!requestIsCurrent()) return;
        const candidatePool =
          requestMode === 'optimize' && snapshot.candidateSearch.selectedScope
            ? await window.desktopApi.dictionarySearch({
                locale: snapshot.locale,
                query: '',
                facetValueIds: [],
                excludeDrafts: false,
                excludeUncited: false,
                includeArchived: false,
                packReleaseIds: [...snapshot.candidateSearch.packReleaseIds],
                includeLocalTerms: snapshot.candidateSearch.includeLocalTerms,
              })
            : snapshot.allTerms;
        if (!requestIsCurrent()) return;
        const candidateTerms =
          requestMode === 'optimize'
            ? rankPromptDraftTermCandidates({
                terms: candidatePool,
                selectedTermIds: snapshot.selectedTermIds,
                excludedTermIds: snapshot.excludedTermIds,
                selectedFacetValueIds: snapshot.selectedFacetValueIds,
                signalTexts: snapshot.signalTexts,
              }).map((term) => creatorAssistantTermInput(term, undefined, snapshot.locale, snapshot.promptProfileId))
            : [];
        const turn = await window.desktopApi.agentAssist({
          scope,
          ...(creationId ? { creationId } : {}),
          mode: requestMode,
          webSearchMode,
          ...snapshot.assistContext,
          contentNodes: snapshot.contentNodes,
          candidateTerms,
          ...(requestMode === 'directions' ? { previousDirectionCoverage: snapshot.previousDirectionCoverage } : {}),
          contextKey: snapshot.assistantContextKey,
          referenceAssets: snapshot.referenceAssets,
          termPromptLocale: snapshot.termPromptLocale,
          canvasPresetKey: snapshot.canvasPresetKey,
          canvasWidth: snapshot.canvasWidth,
          canvasHeight: snapshot.canvasHeight,
          generationTargets: snapshot.generationTargets.map((target) => ({ ...target })),
        });
        await refresh().catch(() => undefined);
        if (!requestIsCurrent()) return;
        onRun(turn);
        setProgressEvents(turn.activityEvents ?? []);
        if (turn.status !== 'SUCCEEDED') {
          setError(
            turn.errorMessage || (snapshot.locale === 'zh' ? '助手提案未完成' : 'Assistant proposal did not complete'),
          );
        } else if (requestMode === 'directions' && turn.creationId) {
          onDirectionsCreated(turn);
        }
      } catch (reason) {
        if (!requestIsCurrent()) return;
        const message = errorMessage(reason);
        setError(
          message.includes('Configure and enable the DeepSeek API extension') ||
            message.includes('DeepSeek V4 Flash is unavailable')
            ? options.configurationRequiredMessage
            : message,
        );
      } finally {
        if (requestRevisionRef.current === requestRevision) {
          busyRef.current = false;
          setBusy(false);
          setMode(null);
        }
      }
    },
  );

  return { busy, clearError, dismiss, error, mode, progressEvents, reportError, request, reset, restore };
}
