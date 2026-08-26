import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CodexUsageServiceTier } from '@/shared/contracts/codex-usage';

const MAX_CODEX_CONFIG_BYTES = 1024 * 1024;
const MAX_CODEX_CONFIG_LINES = 20_000;
const serviceTierValueSchema = z.string().trim().min(1).max(100);
const serviceTierFallbackSchema = z
  .object({
    serviceTier: z.enum(['STANDARD', 'FAST']),
    effectiveFromEpoch: z.number().int().nonnegative().safe(),
    sourceRevision: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type CodexUsageServiceTierFallback = z.infer<typeof serviceTierFallbackSchema>;

function hasForbiddenPathSegment(candidate: string) {
  return candidate.split(path.sep).some((segment) => segment.toLowerCase().includes('trash'));
}

function decodedTomlString(token: string) {
  let decoded: unknown;
  try {
    decoded = token.startsWith('"') ? (JSON.parse(token) as unknown) : token.slice(1, -1);
  } catch {
    return null;
  }
  const parsed = serviceTierValueSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function topLevelServiceTier(encoded: string) {
  const key = String.raw`(?:service_tier|"service_tier"|'service_tier')`;
  const value = String.raw`("(?:[^"\\]|\\.)*"|'[^']*')`;
  const assignment = new RegExp(String.raw`^\s*${key}\s*=\s*${value}\s*(?:#.*)?$`);
  const lines = encoded.replace(/^\uFEFF/, '').split(/\r?\n/, MAX_CODEX_CONFIG_LINES);
  for (const line of lines) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(assignment);
    if (match?.[1]) return decodedTomlString(match[1]);
  }
  return null;
}

function configuredServiceTier(value: string | null): Exclude<CodexUsageServiceTier, 'UNKNOWN'> | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'default' || normalized === 'standard') return 'STANDARD';
  if (normalized === 'priority' || normalized === 'fast') return 'FAST';
  return null;
}

async function readBoundedConfig(configPath: string) {
  const metadata = await lstat(configPath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > BigInt(MAX_CODEX_CONFIG_BYTES)) return null;
  const size = Number(metadata.size);
  const handle = await open(configPath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) return null;
    return { buffer, effectiveFromEpoch: Number(metadata.mtimeNs / 1_000_000n) };
  } finally {
    await handle.close();
  }
}

export async function resolveCodexUsageServiceTierFallback(
  codexHome: string,
): Promise<CodexUsageServiceTierFallback | null> {
  const root = path.resolve(codexHome);
  const configPath = path.join(root, 'config.toml');
  if (hasForbiddenPathSegment(configPath)) return null;
  try {
    const config = await readBoundedConfig(configPath);
    if (!config) return null;
    const serviceTier = configuredServiceTier(topLevelServiceTier(config.buffer.toString('utf8')));
    if (!serviceTier) return null;
    return serviceTierFallbackSchema.parse({
      serviceTier,
      effectiveFromEpoch: config.effectiveFromEpoch,
      sourceRevision: createHash('sha256').update(config.buffer).digest('hex'),
    });
  } catch {
    return null;
  }
}

export function inferredServiceTier(timestamp: string, fallback: CodexUsageServiceTierFallback | null | undefined) {
  if (!fallback) return null;
  const epoch = Date.parse(timestamp);
  return Number.isFinite(epoch) && epoch >= fallback.effectiveFromEpoch ? fallback.serviceTier : null;
}
