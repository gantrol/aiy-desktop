import type { CodexUsageServiceTier } from '@/shared/contracts/codex-usage';
import { codexUsageModelPrice } from '@/shared/codex-usage-rate-card';

export function codexUsageSpeedCreditMultiplier(normalizedModel: string, serviceTier: CodexUsageServiceTier) {
  if (serviceTier === 'STANDARD') return 1;
  if (serviceTier !== 'FAST') return null;
  return codexUsageModelPrice(normalizedModel)?.fastCreditMultiplier ?? null;
}

export function codexUsageStandardEquivalentMultiplier(normalizedModel: string, serviceTier: CodexUsageServiceTier) {
  return codexUsageSpeedCreditMultiplier(normalizedModel, serviceTier);
}
