import { createVitestConfig } from './vitest.shared';

/**
 * Microbenchmark lane. Not a pass/fail gate — it characterises the storage layer
 * so growth curves are visible before a user's library finds them.
 *
 * Run against a seeded library; compare medians across runs on one machine.
 * Absolute numbers from CI hardware are noise.
 */
export default createVitestConfig({
  include: ['bench/**/*.bench.ts'],
});
