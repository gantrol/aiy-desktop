import path from 'node:path';
import { createVitestConfig } from './vitest.shared';

/**
 * Component lane. Real DOM, real effects, real events.
 *
 * The older `*.test.ts` component checks render through `renderToStaticMarkup`,
 * which cannot run an effect or dispatch an event — it only observes the first
 * render's HTML string. Behaviour that depends on refs, layout measurement,
 * pointer gestures, or state transitions belongs here instead.
 */
export default createVitestConfig({
  include: ['tests/**/*.dom.test.tsx'],
  environment: 'jsdom',
  setupFiles: [path.resolve(__dirname, 'tests/support/dom-setup.ts')],
});
