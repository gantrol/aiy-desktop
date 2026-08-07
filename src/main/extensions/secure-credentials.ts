export interface SecretProtector {
  isAvailable(): boolean;
  protect(value: string): Buffer;
  unprotect(value: Buffer): string;
}

export function validateApiSecret(value: string, label = 'API key') {
  const normalized = value.trim();
  if (normalized.length < 12 || normalized.length > 500 || /\s/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export function secretHint(value: string) {
  return `••••••••${value.slice(-4)}`;
}
