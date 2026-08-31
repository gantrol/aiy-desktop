import { useEffect, useRef, useState } from 'react';
import type {
  CreationDictionaryScopeDto,
  CreatorAgentScope,
  HistoricalTermRecommendationRunDto,
  Locale,
} from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface RecommendationInput {
  candidateTermIds: readonly string[];
  dictionaryPackReleaseIds: readonly string[];
  dictionaryScope: CreationDictionaryScopeDto;
  locale: Locale;
  prompt: string;
  scope: CreatorAgentScope | null;
  selectedTermIds: readonly string[];
}

interface Options extends RecommendationInput {
  enabled: boolean;
  notify(message: string): void;
}

function inputSnapshot(input: RecommendationInput): RecommendationInput {
  return {
    ...input,
    candidateTermIds: [...input.candidateTermIds],
    dictionaryPackReleaseIds: [...input.dictionaryPackReleaseIds],
    dictionaryScope: {
      ...input.dictionaryScope,
      sources: input.dictionaryScope.sources.map((source) => ({ ...source })),
    },
    scope: input.scope ? { ...input.scope } : null,
    selectedTermIds: [...input.selectedTermIds],
  };
}

function inputIdentity(input: RecommendationInput) {
  return JSON.stringify(inputSnapshot(input));
}

function scopeIdentity(scope: CreatorAgentScope | null) {
  return scope ? `${scope.kind}:${scope.id}` : 'none';
}

export function useHistoricalTermRecommendations(options: Options) {
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<HistoricalTermRecommendationRunDto[]>([]);
  const busyRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const notify = useStableCallback(options.notify);
  const captureInput = useStableCallback(() =>
    inputSnapshot({
      candidateTermIds: options.candidateTermIds,
      dictionaryPackReleaseIds: options.dictionaryPackReleaseIds,
      dictionaryScope: options.dictionaryScope,
      locale: options.locale,
      prompt: options.prompt,
      scope: options.scope,
      selectedTermIds: options.selectedTermIds,
    }),
  );
  const scopeKey = scopeIdentity(options.scope);

  useEffect(() => {
    if (!options.enabled) {
      operationGenerationRef.current += 1;
      busyRef.current = false;
      setBusy(false);
      return undefined;
    }
    const operationGeneration = ++operationGenerationRef.current;
    const scope = options.scope ? { ...options.scope } : null;
    busyRef.current = true;
    setBusy(true);
    void window.desktopApi
      .historicalTermRecommendationsList({ scope, limit: 6 })
      .then((nextRuns) => {
        if (operationGenerationRef.current === operationGeneration) setRuns(nextRuns);
      })
      .catch((reason) => {
        if (operationGenerationRef.current === operationGeneration)
          notify(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (operationGenerationRef.current !== operationGeneration) return;
        busyRef.current = false;
        setBusy(false);
      });
    return () => {
      operationGenerationRef.current += 1;
    };
  }, [notify, options.enabled, options.scope, scopeKey]);

  const recommend = useStableCallback(async () => {
    const input = captureInput();
    if (busyRef.current || (!input.prompt.trim() && !input.selectedTermIds.length)) return;
    const identity = inputIdentity(input);
    const operationGeneration = ++operationGenerationRef.current;
    const operationIsLatest = () => operationGenerationRef.current === operationGeneration;
    const inputIsCurrent = () => inputIdentity(captureInput()) === identity;
    busyRef.current = true;
    setBusy(true);
    try {
      const candidateTermIds =
        input.dictionaryScope.mode === 'SELECTED'
          ? (
              await window.desktopApi.dictionarySearch({
                locale: input.locale,
                query: '',
                facetValueIds: [],
                excludeDrafts: false,
                excludeUncited: false,
                includeArchived: false,
                packReleaseIds: [...input.dictionaryPackReleaseIds],
                includeLocalTerms: input.dictionaryScope.includeLocalTerms,
              })
            ).map((term) => term.id)
          : [...input.candidateTermIds];
      if (!operationIsLatest() || !inputIsCurrent()) return;
      const run = await window.desktopApi.historicalTermRecommendationsCreate({
        scope: input.scope,
        prompt: input.prompt,
        selectedTermIds: [...input.selectedTermIds],
        candidateTermIds,
        locale: input.locale,
        limit: 8,
      });
      if (!operationIsLatest() || !inputIsCurrent()) return;
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 6));
    } catch (reason) {
      if (operationIsLatest() && inputIsCurrent()) notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operationIsLatest()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  });

  return { busy, recommend, runs };
}
