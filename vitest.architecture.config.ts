import { createVitestConfig } from './vitest.shared';

export default createVitestConfig({
  include: ['tests/**/*.architecture.test.ts'],
});
