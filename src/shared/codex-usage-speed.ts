import type { CodexUsageServiceTier } from '@/shared/contracts/codex-usage';

export function codexUsageSpeedCreditMultiplier(normalizedModel: string, serviceTier: CodexUsageServiceTier) {
  if (serviceTier === 'STANDARD') return 1;
  if (serviceTier !== 'FAST') return null;
  if (
    normalizedModel === 'gpt-5.6-sol' ||
    normalizedModel === 'gpt-5.6-terra' ||
    normalizedModel === 'gpt-5.6-luna' ||
    normalizedModel === 'gpt-5.5'
  ) {
    return 2.5;
  }
  if (normalizedModel === 'gpt-5.4') return 2;
  return null;
}

export function codexUsageStandardEquivalentMultiplier(normalizedModel: string, serviceTier: CodexUsageServiceTier) {
  // Keep unknown or unsupported usage at its observed 1x value; only confirmed Fast usage may increase the estimate.
  return codexUsageSpeedCreditMultiplier(normalizedModel, serviceTier) ?? 1;
}
