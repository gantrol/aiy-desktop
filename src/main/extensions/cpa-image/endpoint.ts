import { networkOriginExtensionPermission } from '@/shared/extension-permissions';

export const CPA_IMAGE_DEFAULT_BASE_URL = 'http://127.0.0.1:8317/v1';

export function validatedCpaImageBaseUrl(value: string) {
  const raw = value.trim().replace(/\/$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('CPA_IMAGE_ENDPOINT_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    raw.length > 2_048 ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith('/v1') ||
    /%|\\|\/\//.test(parsed.pathname)
  ) {
    throw new Error('CPA_IMAGE_ENDPOINT_INVALID');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function cpaImageEndpointPermission(baseUrl: string) {
  return networkOriginExtensionPermission(validatedCpaImageBaseUrl(baseUrl));
}
