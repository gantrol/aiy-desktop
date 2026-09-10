import { createContext, useContext } from 'react';
import type { AssetFileRevealContext } from '@/shared/contracts';
import { contentSourceSchema } from '@/shared/contracts/content-library';

export function assetFileRevealContextFromElement(element: Element | null): AssetFileRevealContext | undefined {
  const raw = element?.closest('[data-content-source]')?.getAttribute('data-content-source');
  if (!raw) return undefined;
  try {
    return { kind: 'CONTENT', source: contentSourceSchema.parse(JSON.parse(raw)) };
  } catch {
    return undefined;
  }
}

const Context = createContext<AssetFileRevealContext | undefined>(undefined);
export const AssetFileRevealContextProvider = Context.Provider;
export function useAssetFileRevealContext() {
  return useContext(Context);
}
