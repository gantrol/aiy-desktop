import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Durable model-family and product names for imported-image provenance. Exact
 * versions remain free text, while library history is merged in at runtime.
 * Retired model families remain valid attribution for imported assets.
 */
const modelDefaults = [
  'GPT Image 2',
  'GPT Image 1.5',
  'GPT Image 1',
  'DALL·E 3',
  'Nano Banana 2',
  'Nano Banana 2 Lite',
  'Nano Banana Pro',
  'Nano Banana',
  'Midjourney',
  'Niji',
  'FLUX.2',
  'FLUX.1',
  'Stable Diffusion 3.5',
  'Stable Diffusion XL',
  'Adobe Firefly Image',
  'Ideogram',
  'Recraft',
  'Krea 2',
  'Seedream',
  'Qwen Image',
  'Hunyuan Image',
  'Kling Image',
  'Kolors',
  'ERNIE-ViLG',
  'Z-Image',
] as const;

function uniqueSuggestions(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Provenance values stay user-authored facts rather than executable route
 * aliases. Suggestions combine this library's prior facts and a starter
 * catalog; selecting one still records only the visible free-text value.
 */
export function useProvenanceSuggestions(platformDefaults: readonly string[], enabled = true) {
  const [knownModelNames, setKnownModelNames] = useState<string[]>([]);
  const [knownPlatforms, setKnownPlatforms] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    void window.desktopApi
      .materialProvenanceSuggestions()
      .then((result) => {
        if (!current) return;
        setKnownModelNames((values) => uniqueSuggestions([...values, ...result.modelNames]));
        setKnownPlatforms((values) => uniqueSuggestions([...values, ...result.modelProviders]));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);

  const modelNames = useMemo(() => uniqueSuggestions([...knownModelNames, ...modelDefaults]), [knownModelNames]);
  const platforms = useMemo(
    () => uniqueSuggestions([...knownPlatforms, ...platformDefaults]),
    [knownPlatforms, platformDefaults],
  );
  const remember = useCallback((modelName: string, platform: string) => {
    setKnownModelNames((values) => uniqueSuggestions([...values, modelName]));
    setKnownPlatforms((values) => uniqueSuggestions([...values, platform]));
  }, []);

  return { modelNames, platforms, remember };
}
