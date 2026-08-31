import { DEEPSEEK_PROVIDER } from '@/main/assistant-models/deepseek-provider';
import {
  EXTENSION_PERMISSION,
  EXTENSION_PERMISSION_TEMPLATE,
  networkOriginExtensionPermission,
} from '@/shared/extension-permissions';

export const DEEPSEEK_VISION_ENDPOINT_PERMISSION = EXTENSION_PERMISSION_TEMPLATE.userConfiguredDeepSeekVisionEndpoint;
export const DEEPSEEK_VISION_REFERENCE_PERMISSION = EXTENSION_PERMISSION.libraryReadSelectedReferences;

export function validatedDeepSeekVisionSettings(endpointValue: string, modelValue: string) {
  const endpoint = endpointValue.trim();
  const modelId = modelValue.trim();
  if (!endpoint && !modelId) return { visionEndpoint: '', visionModelId: '' };
  if (!endpoint || !modelId) throw new Error('DeepSeek vision endpoint and model ID must both be set');
  if (endpoint.length > 2_048 || modelId.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)) {
    throw new Error('DeepSeek vision settings are invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('DeepSeek vision endpoint is invalid');
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname === '/'
  ) {
    throw new Error('DeepSeek vision endpoint must be an HTTPS Chat Completions URL or an HTTP loopback URL');
  }
  return { visionEndpoint: parsed.toString(), visionModelId: modelId };
}

export function deepSeekVisionEndpointPermission(endpoint: string) {
  if (!endpoint) return null;
  return new URL(endpoint).origin === DEEPSEEK_PROVIDER.origin ? null : networkOriginExtensionPermission(endpoint);
}
