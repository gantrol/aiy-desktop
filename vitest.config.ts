import path from 'node:path';
import { createVitestConfig } from './vitest.shared';

/**
 * Full verification runs node and jsdom tests as separate Vitest projects in one
 * process. Coverage is owned by the root process, so both environments contribute
 * to one report with the whole application as its denominator.
 */
export default createVitestConfig({
  coverageThresholds: {
    // Combined node + jsdom release-source baseline measured on 2026-08-07
    // with Node 22.22.3 and Vitest 4.1.10.
    lines: 28.4,
    statements: 26.5,
    functions: 24,
    branches: 21.3,
    'src/renderer/components/**': {
      lines: 12.9,
      statements: 12.3,
      functions: 12.1,
      branches: 12.3,
    },
    'src/main/database/**': {
      lines: 67.2,
      statements: 62.8,
      functions: 66.5,
      branches: 50.8,
    },
    // Zero-percent process boundaries use uncovered-item ceilings so adding
    // more untested code fails even before the first positive percentage lands.
    'src/main/model-worker/**': {
      lines: -1024,
      statements: -1141,
      functions: -215,
      branches: -591,
    },
    'src/main/ipc.ts': {
      lines: -505,
      statements: -567,
      functions: -165,
      branches: -172,
    },
    'src/main/ipc/**': {
      lines: -189,
      statements: -219,
      functions: -73,
      branches: -64,
    },
    'src/preload/**': {
      lines: -258,
      statements: -273,
      functions: -189,
    },
  },
  projects: [
    {
      name: 'node',
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
    {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/**/*.dom.test.tsx'],
      setupFiles: [path.resolve(__dirname, 'tests/support/dom-setup.ts')],
    },
  ],
});
