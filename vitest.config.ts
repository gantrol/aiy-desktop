import path from 'node:path';
import { createVitestConfig } from './vitest.shared';

/**
 * Full verification runs node and jsdom tests as separate Vitest projects in one
 * process. Coverage is owned by the root process, so both environments contribute
 * to one report with the whole application as its denominator.
 */
export default createVitestConfig({
  coverageThresholds: {
    // Combined node + jsdom baseline from 2026-08-04. These floors leave at
    // most a few uncovered statements of rounding tolerance.
    lines: 29.4,
    statements: 27.1,
    functions: 25.3,
    branches: 22.7,
    'src/renderer/components/**': {
      lines: 14.5,
      statements: 13.6,
      functions: 13.7,
      branches: 14,
    },
    'src/main/database/**': {
      lines: 65.7,
      statements: 61.2,
      functions: 66.8,
      branches: 50.6,
    },
    // Zero-percent process boundaries use uncovered-item ceilings so adding
    // more untested code fails even before the first positive percentage lands.
    'src/main/model-worker/**': {
      lines: -785,
      statements: -887,
      functions: -165,
      branches: -477,
    },
    'src/main/ipc.ts': {
      lines: -424,
      statements: -492,
      functions: -148,
      branches: -126,
    },
    'src/main/ipc/**': {
      lines: -126,
      statements: -151,
      functions: -55,
      branches: -49,
    },
    'src/preload/**': {
      lines: -162,
      statements: -172,
      functions: -158,
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
