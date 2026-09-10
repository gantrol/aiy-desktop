import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GifGenerationCandidate,
  GifGenerationState,
  GifGenerationProgress,
} from '@/shared/contracts/gif-generation';
import { gifErrorCode } from '@/shared/contracts/gif-making';
import { gifMotionPlanSchema } from '@/shared/contracts/gif-motion-plan';
import { useGifGenerationRoutes } from '@/renderer/features/gif-making/useGifGenerationRoutes';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useGifMotionIntent } from '@/renderer/features/gif-making/useGifMotionIntent';

export function useGifGeneration(
  model: GifMakerModel,
  onAdopt: (candidate: GifGenerationCandidate, copy: boolean) => Promise<void>,
  onGenerated: (candidate: GifGenerationCandidate) => void,
) {
  const { locale } = useI18n();
  const { project, selectedAsset: source } = model;
  const { routes, modelKey: defaultModelKey } = useGifGenerationRoutes(true, project.setError);
  const intent = useGifMotionIntent(project);
  const modelKey = intent.modelKey || defaultModelKey;
  const { prompt, mode, region, plan, durationMs, feather, quality, generationMode, returnMode } = intent;
  const [planning, setPlanning] = useState(false);
  const [candidate, setCandidate] = useState<GifGenerationCandidate | null>(null);
  const [history, setHistory] = useState<GifGenerationCandidate[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [state, setState] = useState<GifGenerationState | null>(null);
  const [progress, setProgress] = useState<GifGenerationProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const active = useRef<string | null>(null);
  const activity = useRef(0);
  const adoptionLock = useRef(false);
  const alive = useRef(true);
  const context = useRef(project.document.id);
  const cancelled = useRef(false);
  const sourceKey = useRef(source?.id);
  context.current = project.document.id;
  const { setError, addAssets } = project;

  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.desktopApi.onGifGenerationProgress((event) => {
      if (event.id === active.current && event.documentId === context.current) {
        setState(event.state);
        setProgress(event);
      }
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (project.loading) return;
    let disposed = false;
    const revision = activity.current;
    setCandidate(null);
    setHistory([]);
    setHistoryLoading(Boolean(project.document.revision));
    setProviderMessage(null);
    setState(null);
    setProgress(null);
    sourceKey.current = source?.id;
    if (project.document.revision)
      void Promise.all([
        window.desktopApi.gifGenerationLatest(project.document.id),
        window.desktopApi.gifGenerationHistory(project.document.id),
      ])
        .then(([value, results]) => {
          if (disposed) return;
          setHistory((items) =>
            [...items, ...results.filter((result) => !items.some((item) => item.id === result.id))].slice(0, 20),
          );
          addAssets(results.flatMap((item) => item.assets));
          setCandidate((current) => current ?? results[0] ?? null);
          if (activity.current !== revision) return;
          if (!value) return;
          setState(value.state);
          if (value.errorCode) setError(gifErrorCode(value.errorCode));
          setProviderMessage(value.providerMessage);
          // Read older projects without a separately saved motion form.
          if (!project.capture().motionDraft) {
            const { settings } = value;
            project.updateDraft({
              prompt: settings.prompt,
              mode: settings.mode,
              region: settings.region,
              feather: settings.feather,
              durationMs: settings.durationMs,
              modelKey: settings.modelKey,
              quality: settings.quality,
              generationMode: settings.generationMode,
              returnMode: settings.plan?.returnMode ?? 'CONTINUE',
              plan: settings.plan ?? null,
            });
          }
        })
        .catch(() => {
          if (!disposed && activity.current === revision) setError('GIF_FAILED');
        })
        .finally(() => {
          if (!disposed) setHistoryLoading(false);
        });
    return () => {
      disposed = true;
    };
    // Autosave revisions must not reset a live request or replace its form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.document.id, project.loading, addAssets, setError]);

  useEffect(() => {
    if (project.loading || sourceKey.current === source?.id) return;
    sourceKey.current = source?.id;
    activity.current += 1;
    intent.resetSource();
    // Source changes invalidate only the plan; existing results remain available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, project.loading]);

  const isCurrent = (documentId: string) => alive.current && context.current === documentId;
  const isBusy = () => active.current !== null || adoptionLock.current || model.busy;
  const perform = async (planningOnly: boolean) => {
    if (isBusy() || !source || !prompt.trim()) return;
    if (!planningOnly && !modelKey) return;
    const confirmed = gifMotionPlanSchema.safeParse(
      plan && { ...plan, mode, region: mode === 'REGION' ? region : null, durationMs },
    );
    if (!planningOnly && !confirmed.success) {
      setError('GIF_PLAN_REQUIRED');
      return;
    }
    const id = crypto.randomUUID(),
      documentId = project.document.id;
    active.current = id;
    activity.current += 1;
    cancelled.current = false;
    setRunning(true);
    setPlanning(planningOnly);
    setState(planningOnly ? null : 'PREPARING');
    setProgress(null);
    setError(null);
    setProviderMessage(null);
    try {
      const expected = project.capture();
      const saved = await project.save();
      if (!isCurrent(documentId) || cancelled.current) throw new Error('GIF_CANCELLED');
      if (planningOnly) {
        const result = await window.desktopApi.gifPlan({
          id,
          documentId,
          expectedRevision: saved.revision,
          sourceAssetId: source.id,
          prompt,
          locale,
          mode,
          returnMode,
          region: mode === 'REGION' ? region : null,
        });
        if (isCurrent(documentId) && !cancelled.current) {
          if (!intent.applyPlan(result.plan, expected)) setError('GIF_PLAN_REQUIRED');
        }
      } else if (confirmed.success) {
        const value = await window.desktopApi.gifGenerate({
          id,
          documentId,
          expectedRevision: saved.revision,
          titleLocale: locale,
          settings: {
            sourceAssetId: source.id,
            modelKey,
            prompt,
            mode,
            region: mode === 'REGION' ? region : null,
            feather,
            keyframes: confirmed.data.states.length,
            durationMs,
            quality,
            generationMode,
            plan: confirmed.data,
          },
        });
        if (!isCurrent(documentId)) return;
        addAssets(value.assets);
        setCandidate(value);
        setHistory((items) => [value, ...items.filter((item) => item.id !== value.id)].slice(0, 20));
        setState(value.state);
        onGenerated(value);
      }
    } catch (reason) {
      if (isCurrent(documentId)) {
        const code = gifErrorCode(reason);
        setError(code);
        setState(code === 'GIF_CANCELLED' ? 'CANCELLED' : 'FAILED');
        if (!planningOnly) {
          const failure = await window.desktopApi.gifGenerationLatest(documentId).catch(() => null);
          if (isCurrent(documentId) && failure?.id === id) setProviderMessage(failure.providerMessage);
        }
      }
    } finally {
      active.current = null;
      if (alive.current) {
        setPlanning(false);
        setRunning(false);
      }
    }
  };
  const cancel = async () => {
    cancelled.current = true;
    try {
      if (active.current) await window.desktopApi.gifGenerationCancel(active.current);
    } catch (reason) {
      if (alive.current) setError(gifErrorCode(reason));
    }
  };
  const adopt = async (copy = false) => {
    if (isBusy() || !candidate?.manifest) return;
    adoptionLock.current = true;
    setAdopting(true);
    try {
      await onAdopt(candidate, copy);
    } catch (reason) {
      setError(gifErrorCode(reason));
    } finally {
      adoptionLock.current = false;
      setAdopting(false);
    }
  };
  const failedPreview = useCallback(() => setError('GIF_ASSET_UNAVAILABLE'), [setError]);
  return {
    ...intent,
    routes,
    modelKey,
    source,
    candidate,
    history,
    historyLoading,
    providerMessage,
    selectCandidate: (id: string) => {
      const value = history.find((item) => item.id === id);
      if (value) {
        activity.current += 1;
        setCandidate(value);
      }
    },
    state,
    progress,
    running,
    adopting,
    planning,
    generate: () => perform(false),
    propose: () => perform(true),
    cancel,
    adopt,
    failedPreview,
  };
}
export type GifGenerationModel = ReturnType<typeof useGifGeneration>;
