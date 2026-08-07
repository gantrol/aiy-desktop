import { existsSync } from 'node:fs';
import path from 'node:path';

const mainEntry = path.resolve(__dirname, '../../out/main/index.js');

/**
 * The E2E lane runs the built app, not the dev server, so a stale or missing
 * bundle is the single most common cause of a confusing failure. Fail here with
 * the fix instead of thirty seconds into a launch timeout.
 */
export default function globalSetup() {
  if (existsSync(mainEntry)) return;
  throw new Error(
    `Electron main bundle not found at ${mainEntry}.\n` +
      'Build once before running the end-to-end lane:\n\n' +
      '  npm run build\n',
  );
}
