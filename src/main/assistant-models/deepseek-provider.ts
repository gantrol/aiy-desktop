export const DEEPSEEK_PROVIDER_KEY = 'deepseek';
export const DEEPSEEK_DEFAULT_MODEL_ID = 'deepseek-v4-flash';
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

export interface DeepSeekProviderDefinition {
  readonly providerKey: typeof DEEPSEEK_PROVIDER_KEY;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly origin: string;
  readonly modelsUrl: string;
  readonly responsesUrl: string;
}

function validatedBaseUrl(value: string) {
  const parsed = new URL(value);
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('DeepSeek base URL must be HTTPS (or an HTTP loopback URL) without credentials or query data');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function resolveDeepSeekProviderDefinition(
  override: { baseUrl?: string; modelId?: string } = {},
): DeepSeekProviderDefinition {
  const modelId = override.modelId?.trim() || DEEPSEEK_DEFAULT_MODEL_ID;
  if (modelId.length > 200 || /\s/.test(modelId)) throw new Error('DeepSeek model ID is invalid');
  const baseUrl = validatedBaseUrl(override.baseUrl?.trim() || DEEPSEEK_DEFAULT_BASE_URL);
  return Object.freeze({
    providerKey: DEEPSEEK_PROVIDER_KEY,
    modelId,
    baseUrl,
    origin: new URL(baseUrl).origin,
    modelsUrl: `${baseUrl}/models`,
    responsesUrl: `${baseUrl}/responses`,
  });
}

export const DEEPSEEK_PROVIDER = resolveDeepSeekProviderDefinition();
