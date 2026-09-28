import { app } from 'electron';
import path from 'node:path';
import { isPackagedApplication } from '@/main/app/runtime-mode';

/** Preview keeps each renderer and its preload on the same build for the whole session. */
export function rendererRuntimePath(target: 'renderer' | 'preload', file = '') {
  const previewRoot = !isPackagedApplication(app) && process.env.AIY_PREVIEW_RUNTIME_ROOT;
  const root = previewRoot ? path.resolve(previewRoot) : path.join(app.getAppPath(), 'out');
  return path.join(root, target, file);
}
