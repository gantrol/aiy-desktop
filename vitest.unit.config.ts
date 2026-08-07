import { createVitestConfig } from './vitest.shared';

export default createVitestConfig({
  include: ['tests/**/*.test.ts'],
  exclude: ['tests/**/*.integration.test.ts', 'tests/**/*.architecture.test.ts'],
});
