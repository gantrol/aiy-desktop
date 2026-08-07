import { readFileSync } from 'node:fs';
import path from 'node:path';

const fixtureRoot = path.resolve(__dirname, '../fixtures');

/**
 * Fixtures are hand-authored from the documented provider field structure. They
 * are never recorded from a live call — recording a fixture would mean paying
 * for it, and a recorded payload drifts silently when the provider changes.
 */
export function fixturePath(relativePath: string) {
  const resolved = path.resolve(fixtureRoot, relativePath);
  if (!resolved.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error(`Fixture path escapes tests/fixtures: ${relativePath}`);
  }
  return resolved;
}

export function readFixture(relativePath: string) {
  return readFileSync(fixturePath(relativePath));
}

export function readFixtureJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFixture(relativePath).toString('utf8')) as T;
}

/** Provider fixtures live one directory down; keep call sites short. */
export function openAiFixture(name: string) {
  return `openai-image/${name}`;
}

export function readOpenAiFixtureJson<T = unknown>(name: string): T {
  return readFixtureJson<T>(openAiFixture(name));
}

export function imageFixture(name: string) {
  return fixturePath(`images/${name}`);
}
