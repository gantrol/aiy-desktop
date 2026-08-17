const MILLISECONDS_PER_SECOND = 1_000;

export const QWEN3_ASR_FLASH_BEIJING_API_PRICE = Object.freeze({
  modelId: 'qwen3-asr-flash',
  region: 'BEIJING',
  inputCnyPerSecond: 0.00022,
  verifiedAt: '2026-08-12',
});

export function localQwenAsrApiEquivalentCostCny(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return (durationMs / MILLISECONDS_PER_SECOND) * QWEN3_ASR_FLASH_BEIJING_API_PRICE.inputCnyPerSecond;
}

export function formatLocalQwenAsrApiPriceCny(value: number) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}
