import { describe, expect, it } from 'vitest';
import {
  expandValidCases,
  loadModel,
  loadSeeds,
  pairwise,
  requiredPairs,
  satisfiesConstraints,
} from './support/combinatorial';

/**
 * The generator is test infrastructure, so it gets tested. A silently wrong
 * pairwise set is worse than no pairwise set: it reports coverage it does not
 * have.
 */
describe('generation combinatorial model', () => {
  const model = loadModel('generation.pict');
  const seeds = loadSeeds('generation.seed');
  const universe = expandValidCases(model);
  const suite = pairwise(model, { seeds });

  it('enumerates a constrained universe that is much smaller than the raw product', () => {
    const product = model.factors.reduce((total, factor) => total * factor.values.length, 1);
    // 4 x 2 x 4 x 3 x 3 x 8 x 3 x 3 x 2. Exhaustive execution is not an option;
    // that is the whole reason this model exists.
    expect(product).toBe(41_472);
    expect(universe.length).toBeLessThan(product);
    expect(universe.length).toBeGreaterThan(0);
  });

  it('emits only cases the model permits', () => {
    for (const testCase of suite) expect(satisfiesConstraints(testCase, model)).toBe(true);
  });

  it('covers every reachable value pair', () => {
    const required = requiredPairs(model, universe);
    const covered = new Set<string>();
    for (const testCase of suite) {
      for (let left = 0; left < model.factors.length; left += 1) {
        for (let right = left + 1; right < model.factors.length; right += 1) {
          const leftName = model.factors[left].name;
          const rightName = model.factors[right].name;
          covered.add(`${leftName}=${testCase[leftName]}|${rightName}=${testCase[rightName]}`);
        }
      }
    }
    const missing = [...required].filter((pair) => !covered.has(pair));
    expect(missing).toEqual([]);
  });

  it('keeps the suite small enough to run on every change', () => {
    expect(suite.length).toBeLessThan(universe.length / 10);
    expect(suite.length).toBeLessThanOrEqual(80);
  });

  it('always includes the seeded high-risk cases', () => {
    for (const seed of seeds) {
      const present = suite.some((testCase) =>
        Object.entries(seed).every(([factor, value]) => testCase[factor] === value),
      );
      expect(present, JSON.stringify(seed)).toBe(true);
    }
  });

  it('is deterministic, so a suite diff means the model changed', () => {
    expect(pairwise(model, { seeds })).toEqual(suite);
  });

  it('honours the domain constraints that make cases meaningful', () => {
    for (const testCase of suite) {
      if (testCase.Inputs === 'source_mask') expect(testCase.Operation).toBe('EDIT');
      if (testCase.Delivery !== 'nonstream') expect(testCase.Provider).toBe('openai');
      if (testCase.Persist === 'db_fail') expect(testCase.Outcome).toBe('OK');
      if (testCase.Lifecycle === 'restart') expect(testCase.Outcome).toBe('OK');
      if (testCase.Inputs === 'ref8') expect(['openai', 'gemini']).toContain(testCase.Provider);
    }
  });
});
