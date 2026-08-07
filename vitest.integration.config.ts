import { createVitestConfig } from './vitest.shared';

export default createVitestConfig({
  include: ['tests/**/*.integration.test.ts'],
});
