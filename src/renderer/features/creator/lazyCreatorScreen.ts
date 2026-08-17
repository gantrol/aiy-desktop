import { lazy } from 'react';

function importCreatorScreen() {
  return import('@/renderer/components/CreatorScreen').then((module) => ({ default: module.CreatorScreen }));
}

let creatorScreenPromise: ReturnType<typeof importCreatorScreen> | null = null;

export function loadCreatorScreen() {
  creatorScreenPromise ??= importCreatorScreen().catch((error: unknown) => {
    creatorScreenPromise = null;
    throw error;
  });
  return creatorScreenPromise;
}

export const CreatorScreen = lazy(loadCreatorScreen);
