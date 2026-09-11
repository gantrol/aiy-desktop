import { lstat, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type {
  CodexUsageInvestigation,
  CodexUsageOfficialSpeed,
  CodexUsageTurnSpeedAnalysis,
} from '@/shared/contracts/codex-usage';
import { normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';

const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const UNKNOWN_SPEED: CodexUsageOfficialSpeed = { multiplier: null, source: 'UNKNOWN', asOf: null };

// Speed claims only; these are unrelated to API pricing or the Fast credit multiplier.
// Astra: Codex model catalog, 2026-09-11. Older models: learn.chatgpt.com/docs/agent-configuration/speed.
const BUNDLED_SPEEDS = new Map<string, number>([
  ['gpt-6-astra', 2],
  ['gpt-5.6-sol', 1.5],
  ['gpt-5.6-terra', 1.5],
  ['gpt-5.6-luna', 1.5],
  ['gpt-5.5', 1.5],
  ['gpt-5.4', 1.5],
]);

const catalogSchema = z.object({
  fetched_at: z.string().datetime().nullish().catch(null),
  models: z.array(z.unknown()).max(1_000),
});
const modelSchema = z.object({ slug: z.string().trim().min(1).max(200), service_tiers: z.unknown().optional() });
const tiersSchema = z.array(z.object({ id: z.string(), description: z.string().max(2_000).nullish() })).max(20);

export type CodexOfficialSpeedCatalog = ReadonlyMap<string, CodexUsageOfficialSpeed>;

function forbiddenPath(candidate: string) {
  return candidate.toLowerCase().includes('trash');
}

async function readCatalogJson(catalogPath: string): Promise<unknown> {
  if (forbiddenPath(catalogPath)) return null;
  const resolvedPath = await realpath(catalogPath);
  if (forbiddenPath(resolvedPath)) return null;
  const metadata = await lstat(resolvedPath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_CATALOG_BYTES) return null;
  const handle = await open(resolvedPath, 'r');
  try {
    const buffer = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    const afterRead = await handle.stat();
    if (afterRead.size !== metadata.size || afterRead.mtimeMs !== metadata.mtimeMs) return null;
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')) as unknown;
  } finally {
    await handle.close();
  }
}

function tierSpeedMultiplier(value: unknown): number | null {
  const tiers = tiersSchema.safeParse(value);
  if (!tiers.success) return null;
  const fast = tiers.data.filter((tier) => ['fast', 'priority'].includes(tier.id.trim().toLowerCase()));
  if (!fast.length) return null;
  const multipliers = fast.map((tier) => {
    // Require an explicit speed claim; "2.5x usage" must never become a speed estimate.
    const matches = [...(tier.description ?? '').matchAll(/\b(\d+(?:\.\d+)?)\s*[x×]\s+(?:speed\b|faster\b)/gi)];
    if (matches.length !== 1) return null;
    const multiplier = Number(matches[0][1]);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
  });
  return multipliers.every((value) => value === multipliers[0]) ? multipliers[0] : null;
}

export async function readCodexOfficialSpeedCatalog(
  codexHome: string | null = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'),
): Promise<CodexOfficialSpeedCatalog> {
  const speeds = new Map<string, CodexUsageOfficialSpeed>();
  if (!codexHome) return speeds;
  try {
    const catalog = catalogSchema.safeParse(await readCatalogJson(path.resolve(codexHome, 'models_cache.json')));
    if (!catalog.success) return speeds;
    for (const value of catalog.data.models) {
      const model = modelSchema.safeParse(value);
      if (!model.success) continue;
      const key = normalizeCodexUsageModel(model.data.slug);
      const multiplier = tierSpeedMultiplier(model.data.service_tiers);
      const previous = speeds.get(key);
      speeds.set(key, {
        multiplier: previous && previous.multiplier !== multiplier ? null : multiplier,
        source: 'CODEX_MODEL_CATALOG',
        asOf: catalog.data.fetched_at?.slice(0, 10) ?? null,
      });
    }
  } catch {
    // An absent, changing, or unreadable catalog must not prevent a usage report.
  }
  return speeds;
}

function resolveOfficialSpeed(
  model: string,
  catalog: CodexOfficialSpeedCatalog,
  previous: CodexUsageOfficialSpeed,
): CodexUsageOfficialSpeed {
  const key = normalizeCodexUsageModel(model);
  const current = catalog.get(key);
  // A present but unrecognized tier is unknown, even when a bundled claim exists.
  if (current) return current;
  // Keep the last observed catalog claim if Codex is temporarily unavailable.
  if (previous.source === 'CODEX_MODEL_CATALOG') return previous;
  const multiplier = BUNDLED_SPEEDS.get(key);
  return multiplier === undefined ? UNKNOWN_SPEED : { multiplier, source: 'BUNDLED_REFERENCE', asOf: '2026-09-11' };
}

export function applyCodexOfficialSpeeds(
  analysis: CodexUsageTurnSpeedAnalysis,
  catalog: CodexOfficialSpeedCatalog,
): CodexUsageTurnSpeedAnalysis {
  return {
    ...analysis,
    comparisons: analysis.comparisons.map((comparison) => ({
      ...comparison,
      officialSpeed: resolveOfficialSpeed(comparison.model, catalog, comparison.officialSpeed),
    })),
  };
}

export async function refreshCodexOfficialSpeeds(
  investigation: CodexUsageInvestigation,
): Promise<CodexUsageInvestigation> {
  if (!investigation.turnSpeed?.comparisons.length) return investigation;
  return {
    ...investigation,
    turnSpeed: applyCodexOfficialSpeeds(investigation.turnSpeed, await readCodexOfficialSpeedCatalog()),
  };
}
