import {
  BROWSER_COMPANION_LOOPBACK_ORIGIN,
  BROWSER_COMPANION_MAX_RESPONSE_BYTES,
  BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES,
  BROWSER_COMPANION_MEDIA_PATH,
  BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  BROWSER_COMPANION_REQUEST_PATH,
  BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER,
  BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
  browserCompanionBridgeResponseSchema,
  outputImageSchema,
  type BrowserCompanionHandoff,
  type BrowserCompanionMedia,
  type BrowserCompanionMediaRequest,
  type BrowserCompanionRequest,
  type BrowserCompanionResponse,
  type CompanionSite,
} from '@/lib/protocol';

const MEDIA_ID_HEADER = 'x-aiy-companion-media-id';
const MEDIA_SIZE_HEADER = 'x-aiy-companion-media-size';
const MEDIA_SHA256_HEADER = 'x-aiy-companion-media-sha256';
const MEDIA_MIME_TYPE_HEADER = 'x-aiy-companion-media-type';
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function authorize(
  site: CompanionSite,
  request: BrowserCompanionRequest | BrowserCompanionMediaRequest,
  path: typeof BROWSER_COMPANION_REQUEST_PATH | typeof BROWSER_COMPANION_MEDIA_PATH,
) {
  const rawResponse: unknown = await browser.runtime.sendMessage({
    protocolVersion: 1,
    kind: 'authorize-loopback-request',
    site,
    path,
    request,
  });
  const response = browserCompanionBridgeResponseSchema.parse(rawResponse);
  if (!response.ok || response.kind !== 'authorized-loopback-request') {
    throw new Error(
      !response.ok && response.reason
        ? `Browser companion authorization failed: ${response.reason}`
        : 'Browser companion request was not authorized',
    );
  }
  return response;
}

async function signedFetch(
  site: CompanionSite,
  request: BrowserCompanionRequest | BrowserCompanionMediaRequest,
  path: typeof BROWSER_COMPANION_REQUEST_PATH | typeof BROWSER_COMPANION_MEDIA_PATH,
) {
  const authorization = await authorize(site, request, path);
  const response = await fetch(`${BROWSER_COMPANION_LOOPBACK_ORIGIN}${path}`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      [BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER]: authorization.signature,
    },
    body: authorization.body,
  });
  if (!response.ok && !response.headers.has(BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER)) {
    throw new Error(`Browser companion request failed: HTTP ${response.status}`);
  }
  return { authorization, response };
}

async function readVerifiedJson(
  site: CompanionSite,
  result: Awaited<ReturnType<typeof signedFetch>>,
): Promise<BrowserCompanionResponse> {
  const declaredLength = Number(result.response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > BROWSER_COMPANION_MAX_RESPONSE_BYTES) {
    throw new Error('Browser companion response is too large');
  }
  const body = await result.response.text();
  if (encoder.encode(body).byteLength > BROWSER_COMPANION_MAX_RESPONSE_BYTES) {
    throw new Error('Browser companion response is too large');
  }
  const signature = result.response.headers.get(BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER);
  if (!signature) throw new Error('Browser companion response is unsigned');
  const rawVerification: unknown = await browser.runtime.sendMessage({
    protocolVersion: 1,
    kind: 'verify-loopback-json',
    site,
    requestId: result.authorization.requestId,
    verificationToken: result.authorization.verificationToken,
    body,
    signature,
  });
  const verification = browserCompanionBridgeResponseSchema.parse(rawVerification);
  if (!verification.ok || verification.kind !== 'verified-loopback-json') {
    throw new Error('Browser companion response signature is invalid');
  }
  return verification.response;
}

export async function sendCompanionRequest(
  site: CompanionSite,
  request: BrowserCompanionRequest,
): Promise<BrowserCompanionResponse> {
  return readVerifiedJson(site, await signedFetch(site, request, BROWSER_COMPANION_REQUEST_PATH));
}

export async function downloadCompanionMedia(
  site: CompanionSite,
  handoff: BrowserCompanionHandoff,
  media: BrowserCompanionMedia,
): Promise<File> {
  const result = await signedFetch(
    site,
    {
      protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
      kind: 'read-media',
      handoffId: handoff.handoffId,
      completionToken: handoff.completionToken,
      mediaId: media.mediaId,
    },
    BROWSER_COMPANION_MEDIA_PATH,
  );
  const contentType = result.response.headers.get('content-type') ?? '';
  if (contentType.startsWith('application/json')) {
    const response = await readVerifiedJson(site, result);
    throw new Error(response.kind === 'error' ? response.code : 'MEDIA_DOWNLOAD_FAILED');
  }
  if (
    !result.response.ok ||
    result.response.headers.get(MEDIA_ID_HEADER) !== media.mediaId ||
    result.response.headers.get(MEDIA_SIZE_HEADER) !== String(media.byteSize) ||
    result.response.headers.get(MEDIA_SHA256_HEADER) !== media.sha256 ||
    result.response.headers.get(MEDIA_MIME_TYPE_HEADER) !== media.mimeType ||
    result.response.headers.get('content-length') !== String(media.byteSize) ||
    contentType !== media.mimeType
  ) {
    throw new Error('Browser companion media metadata is invalid');
  }
  const signature = result.response.headers.get(BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER);
  if (!signature) throw new Error('Browser companion media response is unsigned');
  const rawVerification: unknown = await browser.runtime.sendMessage({
    protocolVersion: 1,
    kind: 'verify-loopback-media',
    site,
    requestId: result.authorization.requestId,
    verificationToken: result.authorization.verificationToken,
    media,
    signature,
  });
  const verification = browserCompanionBridgeResponseSchema.parse(rawVerification);
  if (!verification.ok || verification.kind !== 'verified-loopback-media') {
    throw new Error('Browser companion media signature is invalid');
  }
  const bytes = await result.response.arrayBuffer();
  if (bytes.byteLength !== media.byteSize) throw new Error('Browser companion media size changed');
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== media.sha256) {
    throw new Error('Browser companion media integrity check failed');
  }
  return new File([bytes], media.fileName, { type: media.mimeType });
}

export async function uploadCompanionOutput(
  site: CompanionSite,
  handoffId: string,
  sourceUrl: string,
  file: File,
): Promise<BrowserCompanionResponse> {
  if (file.size <= 0 || file.size > BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES) {
    throw new Error('ChatGPT image exceeds the output import limit');
  }
  const bytes = await file.arrayBuffer();
  const image = outputImageSchema.parse({
    fileName: file.name,
    mimeType: file.type.split(';', 1)[0],
    byteSize: bytes.byteLength,
    sha256: hex(await crypto.subtle.digest('SHA-256', bytes)),
  });
  const preparedFetch = await signedFetch(
    site,
    {
      protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
      kind: 'prepare-output-import',
      handoffId,
      sourceUrl,
      image,
    },
    BROWSER_COMPANION_REQUEST_PATH,
  );
  const prepared = await readVerifiedJson(site, preparedFetch);
  if (prepared.kind !== 'output-import-ready') return prepared;

  const response = await fetch(
    `${BROWSER_COMPANION_LOOPBACK_ORIGIN}${BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX}${prepared.uploadToken}`,
    {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': image.mimeType },
      body: bytes,
    },
  );
  return readVerifiedJson(site, {
    authorization: preparedFetch.authorization,
    response,
  });
}
