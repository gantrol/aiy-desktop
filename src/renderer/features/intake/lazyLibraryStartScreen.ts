import { lazy } from 'react';

export const LibraryStartScreen = lazy(() =>
  import('@/renderer/features/intake/LibraryStartScreen').then((module) => ({ default: module.LibraryStartScreen })),
);
