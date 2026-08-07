/**
 * Combinatorial test design.
 *
 * Reads a PICT-style model (`tests/models/*.pict`) and produces a pairwise set:
 * the smallest case list in which every value pair of every factor pair appears
 * at least once. Empirically most field defects are triggered by one or two
 * interacting parameters, so 2-way coverage buys the majority of the detection
 * power of an exhaustive run at a fraction of the cost.
 *
 * Self-contained on purpose. Microsoft PICT is a fine tool, but a generator that
 * needs an external Windows binary cannot run in CI, and a test-design step that
 * only some machines can reproduce is not a test-design step.
 *
 * The factor space here is small enough (~10^4) to enumerate exactly, so
 * constraint satisfiability is decided rather than sampled: no case is emitted
 * that violates the model, and no pair is demanded that the model forbids.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Factor {
  name: string;
  values: string[];
  /** PICT-style weights. Used only to break ties, never to skew coverage. */
  weights: Map<string, number>;
}

export type Predicate =
  | { factor: string; operator: '=' | '<>'; value: string }
  | { factor: string; operator: 'IN' | 'NOT IN'; values: string[] };

export interface Constraint {
  when: Predicate;
  then: Predicate;
}

export interface Model {
  factors: Factor[];
  constraints: Constraint[];
}

export type TestCase = Record<string, string>;

const modelRoot = path.resolve(__dirname, '../models');

function parsePredicate(source: string): Predicate {
  const inMatch = source.match(/\[([^\]]+)\]\s*(NOT\s+IN|IN)\s*\{([^}]*)\}/i);
  if (inMatch) {
    return {
      factor: inMatch[1].trim(),
      operator: /NOT/i.test(inMatch[2]) ? 'NOT IN' : 'IN',
      values: [...inMatch[3].matchAll(/"([^"]*)"/g)].map((match) => match[1]),
    };
  }
  const comparison = source.match(/\[([^\]]+)\]\s*(<>|=)\s*"([^"]*)"/);
  if (!comparison) throw new Error(`Unsupported predicate in model: ${source.trim()}`);
  return {
    factor: comparison[1].trim(),
    operator: comparison[2] as '=' | '<>',
    value: comparison[3],
  };
}

export function parseModel(source: string): Model {
  const factors: Factor[] = [];
  const constraints: Constraint[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^IF\b/i.test(line)) {
      const match = line.match(/^IF\s+(.+?)\s+THEN\s+(.+?);?$/i);
      if (!match) throw new Error(`Unsupported constraint in model: ${line}`);
      constraints.push({ when: parsePredicate(match[1]), then: parsePredicate(match[2]) });
      continue;
    }

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const weights = new Map<string, number>();
    const values = line
      .slice(separator + 1)
      .split(',')
      .map((entry) => {
        const weighted = entry.trim().match(/^(.*?)\s*\((\d+)\)$/);
        const value = (weighted?.[1] ?? entry).trim();
        if (weighted) weights.set(value, Number(weighted[2]));
        return value;
      })
      .filter(Boolean);
    factors.push({ name, values, weights });
  }

  return { factors, constraints };
}

export function loadModel(fileName: string) {
  return parseModel(readFileSync(path.resolve(modelRoot, fileName), 'utf8'));
}

function matches(predicate: Predicate, testCase: TestCase) {
  const actual = testCase[predicate.factor];
  if (actual === undefined) return false;
  switch (predicate.operator) {
    case '=':
      return actual === predicate.value;
    case '<>':
      return actual !== predicate.value;
    case 'IN':
      return predicate.values.includes(actual);
    case 'NOT IN':
      return !predicate.values.includes(actual);
  }
}

export function satisfiesConstraints(testCase: TestCase, model: Model) {
  return model.constraints.every(
    (constraint) => !matches(constraint.when, testCase) || matches(constraint.then, testCase),
  );
}

/** Every combination the model permits. The exact universe, not a sample. */
export function expandValidCases(model: Model): TestCase[] {
  let cases: TestCase[] = [{}];
  for (const factor of model.factors) {
    const next: TestCase[] = [];
    for (const partial of cases) {
      for (const value of factor.values) next.push({ ...partial, [factor.name]: value });
    }
    cases = next;
  }
  return cases.filter((testCase) => satisfiesConstraints(testCase, model));
}

function pairKey(leftFactor: string, leftValue: string, rightFactor: string, rightValue: string) {
  return `${leftFactor}=${leftValue}|${rightFactor}=${rightValue}`;
}

function pairsOf(testCase: TestCase, factors: Factor[]) {
  const keys: string[] = [];
  for (let left = 0; left < factors.length; left += 1) {
    for (let right = left + 1; right < factors.length; right += 1) {
      const leftName = factors[left].name;
      const rightName = factors[right].name;
      keys.push(pairKey(leftName, testCase[leftName], rightName, testCase[rightName]));
    }
  }
  return keys;
}

/** Only pairs that some valid case can actually realise are required. */
export function requiredPairs(model: Model, universe: TestCase[]) {
  const required = new Set<string>();
  for (const testCase of universe) {
    for (const key of pairsOf(testCase, model.factors)) required.add(key);
  }
  return required;
}

function weightOf(testCase: TestCase, model: Model) {
  return model.factors.reduce((total, factor) => total + (factor.weights.get(testCase[factor.name]) ?? 1), 0);
}

export interface PairwiseOptions {
  /** Cases forced into the result regardless of coverage arithmetic. */
  seeds?: TestCase[];
}

/**
 * Greedy set cover. Deterministic: candidates are scored by newly covered pairs,
 * then by model weight, then by their index in the enumerated universe — so the
 * same model always yields the same suite, and a diff means the model changed.
 */
export function pairwise(model: Model, options: PairwiseOptions = {}): TestCase[] {
  const universe = expandValidCases(model);
  if (universe.length === 0) throw new Error('Model constraints admit no valid case');

  const uncovered = requiredPairs(model, universe);
  const selected: TestCase[] = [];

  const take = (testCase: TestCase) => {
    selected.push(testCase);
    for (const key of pairsOf(testCase, model.factors)) uncovered.delete(key);
  };

  for (const seed of options.seeds ?? []) {
    const complete = universe.find((candidate) =>
      Object.entries(seed).every(([factor, value]) => candidate[factor] === value),
    );
    if (!complete) {
      throw new Error(`Seed case is not permitted by the model constraints: ${JSON.stringify(seed)}`);
    }
    take(complete);
  }

  while (uncovered.size > 0) {
    let best: TestCase | null = null;
    let bestScore = -1;
    let bestWeight = -1;

    for (const candidate of universe) {
      let score = 0;
      for (const key of pairsOf(candidate, model.factors)) if (uncovered.has(key)) score += 1;
      if (score === 0) continue;
      const weight = weightOf(candidate, model);
      if (score > bestScore || (score === bestScore && weight > bestWeight)) {
        best = candidate;
        bestScore = score;
        bestWeight = weight;
      }
    }

    if (!best) break;
    take(best);
  }

  return selected;
}

/** Human-readable case label for `describe.each` / `it` titles. */
export function labelCase(testCase: TestCase, factors: string[]) {
  return factors.map((factor) => testCase[factor]).join(' / ');
}

/** Reads real `pict.exe` output, for teams that prefer the external generator. */
export function loadPictOutput(fileName: string): TestCase[] {
  const lines = readFileSync(path.resolve(modelRoot, fileName), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  const columns = header.split('\t').map((entry) => entry.trim());
  return rows.map((row) => {
    const cells = row.split('\t').map((entry) => entry.trim());
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
}

/** Parses the tab-separated seed file into partial cases. */
export function loadSeeds(fileName: string): TestCase[] {
  return loadPictOutput(fileName);
}
