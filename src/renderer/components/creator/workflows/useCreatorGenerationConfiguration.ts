import { useEffect, useMemo, useState } from 'react';
import type { BootstrapDto, GenerationTargetInput, Locale } from '@/shared/contracts';
import { CODEX_APP_SERVER_PROVIDER_KEY, CODEX_CLI_PROVIDER_KEY } from '@/shared/extension-ids';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { initialGenerationTargets } from '@/renderer/components/creator/generationTargetDefaults';

interface Options {
  codex: BootstrapDto['codex'];
  creationMode: 'existing' | 'new';
  defaultPromptLocale: Locale | null;
  generationTargets: readonly GenerationTargetInput[];
  locale: Locale;
  routes: BootstrapDto['imageGenerationRoutes'];
  selectedTermCount: number;
  setGenerationTargets(update: (current: GenerationTargetInput[]) => GenerationTargetInput[]): void;
  setTermPromptLocale(locale: Locale): void;
}

export function useCreatorGenerationConfiguration(options: Options) {
  const {
    codex,
    creationMode,
    defaultPromptLocale,
    generationTargets,
    locale,
    routes: configuredRoutes,
    selectedTermCount,
    setGenerationTargets,
    setTermPromptLocale,
  } = options;
  const [health, setHealth] = useState(codex);

  useEffect(() => {
    if (codex.state === 'checking') void window.desktopApi.codexHealth().then(setHealth);
    else setHealth(codex);
  }, [codex]);

  const routes = useMemo(
    () =>
      configuredRoutes.map((model) =>
        model.providerKey === CODEX_APP_SERVER_PROVIDER_KEY || model.providerKey === CODEX_CLI_PROVIDER_KEY
          ? { ...model, state: health.state === 'ready' ? ('READY' as const) : ('UNAVAILABLE' as const) }
          : model,
      ),
    [configuredRoutes, health.state],
  );
  const selectedModelKeys = useMemo(() => generationTargets.map((target) => target.modelKey), [generationTargets]);
  const promptProfileId = useMemo(
    () => imageGenerationPromptProfileId(routes.find((route) => route.key === generationTargets[0]?.modelKey)),
    [generationTargets, routes],
  );

  useEffect(() => {
    if (!routes.length) return;
    setGenerationTargets((current) => {
      const available = current.filter((target) => routes.some((model) => model.key === target.modelKey));
      if (available.length === current.length && available.length) return current;
      if (available.length) return available;
      const defaults = initialGenerationTargets({ creationDraft: null, imageGenerationRoutes: routes });
      return defaults.length ? defaults : current;
    });
  }, [routes, setGenerationTargets]);

  useEffect(() => {
    if (creationMode === 'new' && selectedTermCount === 0) {
      setTermPromptLocale(defaultPromptLocale ?? locale);
    }
  }, [creationMode, defaultPromptLocale, locale, selectedTermCount, setTermPromptLocale]);

  return { imageGenerationRoutes: routes, promptProfileId, selectedModelKeys };
}
