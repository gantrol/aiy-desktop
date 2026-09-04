import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX,
  BROWSER_COMPANION_EXTENSION_ID,
  BROWSER_COMPANION_LOOPBACK_HOST,
  BROWSER_COMPANION_LOOPBACK_PORT,
  BROWSER_COMPANION_MAX_REQUEST_BYTES,
  BROWSER_COMPANION_MAX_RESPONSE_BYTES,
  BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES,
  BROWSER_COMPANION_MEDIA_PATH,
  BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  BROWSER_COMPANION_REQUEST_CLOCK_SKEW_MS,
  BROWSER_COMPANION_REQUEST_PATH,
  BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER,
  BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
  browserCompanionLoopbackEnvelopeSchema,
  browserCompanionTargetFromWebOrigin,
  resolveBrowserCompanionLoopbackPort,
  type BrowserCompanionBridgeCredentials,
  type BrowserCompanionDeliveredRecord,
  type BrowserCompanionLoopbackEnvelope,
  type BrowserCompanionOutputImage,
  type BrowserCompanionResponse,
} from '@/main/browser-companion/protocol';
import { BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';
import {
  createBrowserCompanionBridgeParameters,
  loadOrCreateBrowserCompanionCredentials,
} from '@/main/browser-companion/loopback-credentials';
import { resolveBrowserCompanionDataPath } from '@/main/browser-companion/data-path';
import type { BrowserCompanionTarget } from '@/shared/contracts/browser-companion';

const REQUEST_CONTENT_TYPE = 'application/json';
const NONCE_CACHE_LIMIT = 4_096;
const BOOTSTRAP_LEASE_MS = 60_000;
const BOOTSTRAP_LIMIT = 128;
const OUTPUT_IMPORT_LEASE_MS = 2 * 60 * 1000;
const OUTPUT_IMPORT_LIMIT = 128;
const MEDIA_ID_HEADER = 'x-aiy-companion-media-id';
const MEDIA_SIZE_HEADER = 'x-aiy-companion-media-size';
const MEDIA_SHA256_HEADER = 'x-aiy-companion-media-sha256';
const MEDIA_MIME_TYPE_HEADER = 'x-aiy-companion-media-type';

export interface BrowserCompanionOutputImportInput {
  handoff: BrowserCompanionDeliveredRecord;
  image: BrowserCompanionOutputImage;
  sourceUrl: string;
  bytes: Uint8Array<ArrayBufferLike>;
}

export interface BrowserCompanionOutputImportResult {
  seriesId: string;
  promptVersionId: string;
  imageAssetId: string;
  adopted: boolean;
}

export type BrowserCompanionOutputImporter = (
  input: BrowserCompanionOutputImportInput,
) => Promise<BrowserCompanionOutputImportResult>;

interface PendingOutputImport {
  requestId: string;
  target: BrowserCompanionTarget;
  handoff: BrowserCompanionDeliveredRecord;
  image: BrowserCompanionOutputImage;
  sourceUrl: string;
  expiry: ReturnType<typeof setTimeout>;
}

interface PendingBootstrap {
  parameters: ReturnType<typeof createBrowserCompanionBridgeParameters>;
  expiry: ReturnType<typeof setTimeout>;
}

function companionError(code: Extract<BrowserCompanionResponse, { kind: 'error' }>['code']): BrowserCompanionResponse {
  return { protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION, ok: false, kind: 'error', code };
}

function tokenKey(credentials: BrowserCompanionBridgeCredentials): Buffer {
  return Buffer.from(credentials.token, 'base64url');
}

function hmac(credentials: BrowserCompanionBridgeCredentials, bytes: Buffer | string): string {
  return createHmac('sha256', tokenKey(credentials)).update(bytes).digest('hex');
}

function matchesHmac(
  credentials: BrowserCompanionBridgeCredentials,
  bytes: Buffer,
  candidate: string | undefined,
): boolean {
  if (!candidate || !/^[a-f0-9]{64}$/.test(candidate)) return false;
  const expected = Buffer.from(hmac(credentials, bytes), 'hex');
  const actual = Buffer.from(candidate, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function mediaSignaturePayload(
  requestId: string,
  media: { mediaId: string; byteSize: number; sha256: string; mimeType: string },
): string {
  return `media\n${requestId}\n${media.mediaId}\n${media.byteSize}\n${media.sha256}\n${media.mimeType}`;
}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes = BROWSER_COMPANION_MAX_REQUEST_BYTES,
): Promise<Buffer | null> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maximumBytes) return null;
    chunks.push(bytes);
  }
  return total > 0 ? Buffer.concat(chunks, total) : null;
}

function outputImportToken(requestUrl: string | undefined): string | null {
  if (!requestUrl?.startsWith(BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX)) return null;
  const token = requestUrl.slice(BROWSER_COMPANION_OUTPUT_IMPORT_PATH_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) ? token : null;
}

function bootstrapId(requestUrl: string | undefined): string | null {
  if (!requestUrl?.startsWith(BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX)) return null;
  const value = requestUrl.slice(BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export class BrowserCompanionLoopbackServer {
  readonly handoffs: BrowserCompanionHandoffStore;
  private server: Server | null = null;
  private credentials: BrowserCompanionBridgeCredentials | null = null;
  private readonly usedNonces = new Map<string, number>();
  private readonly pendingBootstraps = new Map<string, PendingBootstrap>();
  private readonly pendingOutputImports = new Map<string, PendingOutputImport>();
  private outputImporter: BrowserCompanionOutputImporter | null = null;

  constructor(
    readonly dataPath: string,
    private readonly port = BROWSER_COMPANION_LOOPBACK_PORT,
  ) {
    this.handoffs = new BrowserCompanionHandoffStore(dataPath);
  }

  static forAppData(appDataRoot: string, environment: NodeJS.ProcessEnv): BrowserCompanionLoopbackServer {
    return new BrowserCompanionLoopbackServer(
      resolveBrowserCompanionDataPath({
        appDataRoot,
        configuredUserDataPath: environment.AIY_USER_DATA_DIR,
      }),
      resolveBrowserCompanionLoopbackPort(environment),
    );
  }

  setOutputImporter(importer: BrowserCompanionOutputImporter): void {
    this.outputImporter = importer;
  }

  async startSafely(): Promise<void> {
    await this.start().catch((reason: unknown) => {
      console.error('[browser-companion] desktop service could not start', reason);
    });
  }

  async start(): Promise<void> {
    if (this.server?.listening) return;
    const credentials = await loadOrCreateBrowserCompanionCredentials(this.dataPath);
    const server = createServer((request, response) => {
      void this.handleRequest(request, response, credentials).catch((reason: unknown) => {
        console.error('[browser-companion] loopback request failed', reason);
        if (!response.headersSent) response.writeHead(500);
        if (!response.writableEnded) response.end();
      });
    });
    server.maxHeadersCount = 32;
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      const onError = (reason: Error) => {
        server.off('listening', onListening);
        reject(reason);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: BROWSER_COMPANION_LOOPBACK_HOST, port: this.port, exclusive: true });
    });
    this.credentials = credentials;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.credentials = null;
    this.usedNonces.clear();
    for (const pending of this.pendingBootstraps.values()) clearTimeout(pending.expiry);
    this.pendingBootstraps.clear();
    for (const pending of this.pendingOutputImports.values()) clearTimeout(pending.expiry);
    this.pendingOutputImports.clear();
    if (!server) return;
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  prepareLaunchUrl(target: BrowserCompanionTarget, destinationUrl: string): string {
    if (!this.server?.listening || !this.credentials)
      throw new Error('Browser companion desktop service is unavailable');
    const parameters = createBrowserCompanionBridgeParameters(this.credentials, target, destinationUrl, this.port);
    if (this.pendingBootstraps.size >= BOOTSTRAP_LIMIT) {
      const oldest = this.pendingBootstraps.keys().next().value as string | undefined;
      if (oldest) {
        clearTimeout(this.pendingBootstraps.get(oldest)?.expiry);
        this.pendingBootstraps.delete(oldest);
      }
    }
    const bootstrapId = randomUUID();
    const expiry = setTimeout(() => this.pendingBootstraps.delete(bootstrapId), BOOTSTRAP_LEASE_MS);
    expiry.unref();
    this.pendingBootstraps.set(bootstrapId, { parameters, expiry });
    return `http://${BROWSER_COMPANION_LOOPBACK_HOST}:${this.port}${BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX}${bootstrapId}`;
  }

  private sendBootstrap(request: IncomingMessage, response: ServerResponse, id: string): void {
    if (request.method !== 'GET') {
      response.writeHead(405);
      response.end();
      return;
    }
    const pending = this.pendingBootstraps.get(id);
    if (!pending) {
      response.writeHead(410);
      response.end();
      return;
    }
    this.pendingBootstraps.delete(id);
    clearTimeout(pending.expiry);

    const { parameters } = pending;
    const message = {
      protocolVersion: 1,
      kind: 'connect-loopback',
      connection: {
        schemaVersion: 1,
        protocolVersion: parameters.protocolVersion,
        port: parameters.port,
        token: parameters.token,
      },
      target: parameters.target,
      destination: parameters.destination,
    } as const;
    const nonce = randomUUID().replaceAll('-', '');
    const html = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>AIY Companion</title><script nonce="${nonce}">(() => { const extensionId = ${scriptJson(BROWSER_COMPANION_EXTENSION_ID)}; const message = ${scriptJson(message)}; let complete = false; const redirect = () => { if (complete) return; complete = true; location.replace(message.destination); }; try { const runtime = globalThis.chrome?.runtime; if (!runtime?.sendMessage) { redirect(); return; } runtime.sendMessage(extensionId, message, () => { void runtime.lastError; redirect(); }); setTimeout(redirect, 3000); } catch { redirect(); } })();</script>`;
    const body = Buffer.from(html, 'utf8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    );
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Length', body.length);
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.writeHead(200);
    response.end(body);
  }

  private origin(request: IncomingMessage): { value: string; target: BrowserCompanionTarget } | null {
    const value = request.headers.origin;
    const target = browserCompanionTargetFromWebOrigin(value);
    return value && target ? { value, target } : null;
  }

  private setCors(response: ServerResponse, origin: string): void {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', `Content-Type, ${BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER}`);
    response.setHeader(
      'Access-Control-Expose-Headers',
      [
        BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
        MEDIA_ID_HEADER,
        MEDIA_SIZE_HEADER,
        MEDIA_SHA256_HEADER,
        MEDIA_MIME_TYPE_HEADER,
      ].join(', '),
    );
    response.setHeader('Vary', 'Origin');
  }

  private validLoopbackHost(request: IncomingMessage): boolean {
    return (
      request.socket.remoteAddress === BROWSER_COMPANION_LOOPBACK_HOST &&
      request.headers.host === `${BROWSER_COMPANION_LOOPBACK_HOST}:${this.port}`
    );
  }

  private validRequestSurface(request: IncomingMessage): boolean {
    return (
      this.validLoopbackHost(request) &&
      (request.url === BROWSER_COMPANION_REQUEST_PATH ||
        request.url === BROWSER_COMPANION_MEDIA_PATH ||
        outputImportToken(request.url) !== null)
    );
  }

  private consumeNonce(envelope: BrowserCompanionLoopbackEnvelope): boolean {
    const oldestAccepted = Date.now() - BROWSER_COMPANION_REQUEST_CLOCK_SKEW_MS;
    for (const [nonce, sentAt] of this.usedNonces) {
      if (sentAt >= oldestAccepted && this.usedNonces.size <= NONCE_CACHE_LIMIT) break;
      this.usedNonces.delete(nonce);
    }
    if (this.usedNonces.has(envelope.nonce)) return false;
    this.usedNonces.set(envelope.nonce, envelope.sentAt);
    return true;
  }

  private sendJson(
    response: ServerResponse,
    credentials: BrowserCompanionBridgeCredentials,
    requestId: string,
    status: number,
    value: BrowserCompanionResponse,
  ): void {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    if (body.length > BROWSER_COMPANION_MAX_RESPONSE_BYTES) {
      response.writeHead(500);
      response.end();
      return;
    }
    response.setHeader('Content-Type', `${REQUEST_CONTENT_TYPE}; charset=utf-8`);
    response.setHeader('Content-Length', body.length);
    response.setHeader(
      BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
      hmac(credentials, `${requestId}\n${body.toString('utf8')}`),
    );
    response.writeHead(status);
    response.end(body);
  }

  private async prepareOutputImport(envelope: BrowserCompanionLoopbackEnvelope): Promise<BrowserCompanionResponse> {
    if (envelope.target !== 'chatgpt' || envelope.request.kind !== 'prepare-output-import') {
      return companionError('OUTPUT_IMPORT_NOT_ALLOWED');
    }
    const request = envelope.request;
    const delivered = await this.handoffs.getDelivered(request.handoffId, envelope.target);
    if ('kind' in delivered) return delivered;
    if (
      delivered.contentKind !== 'prompt' ||
      delivered.source.kind !== 'creation-draft' ||
      !delivered.source.outputTarget
    ) {
      return companionError('OUTPUT_IMPORT_NOT_ALLOWED');
    }
    if (this.pendingOutputImports.size >= OUTPUT_IMPORT_LIMIT) {
      return companionError('STATE_CONFLICT');
    }

    const uploadToken = randomUUID();
    const expiry = setTimeout(() => {
      this.pendingOutputImports.delete(uploadToken);
    }, OUTPUT_IMPORT_LEASE_MS);
    expiry.unref();
    this.pendingOutputImports.set(uploadToken, {
      requestId: envelope.requestId,
      target: envelope.target,
      handoff: delivered,
      image: request.image,
      sourceUrl: request.sourceUrl,
      expiry,
    });
    return {
      protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
      ok: true,
      kind: 'output-import-ready',
      handoffId: delivered.handoffId,
      uploadToken,
    };
  }

  private async receiveOutputImport(
    request: IncomingMessage,
    response: ServerResponse,
    credentials: BrowserCompanionBridgeCredentials,
    target: BrowserCompanionTarget,
    uploadToken: string,
  ): Promise<void> {
    const pending = this.pendingOutputImports.get(uploadToken);
    if (!pending) {
      response.writeHead(404);
      response.end();
      return;
    }
    this.pendingOutputImports.delete(uploadToken);
    clearTimeout(pending.expiry);
    if (pending.target !== target || target !== 'chatgpt') {
      this.sendJson(response, credentials, pending.requestId, 403, companionError('OUTPUT_IMPORT_NOT_ALLOWED'));
      return;
    }
    const contentType = request.headers['content-type']?.split(';', 1)[0];
    const declaredLength = Number(request.headers['content-length']);
    if (
      request.method !== 'POST' ||
      contentType !== pending.image.mimeType ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength !== pending.image.byteSize ||
      declaredLength > BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES
    ) {
      this.sendJson(response, credentials, pending.requestId, 400, companionError('OUTPUT_UPLOAD_CHANGED'));
      return;
    }

    const body = await readRequestBody(request, BROWSER_COMPANION_MAX_OUTPUT_IMPORT_BYTES);
    if (
      !body ||
      body.byteLength !== pending.image.byteSize ||
      createHash('sha256').update(body).digest('hex') !== pending.image.sha256
    ) {
      this.sendJson(response, credentials, pending.requestId, 400, companionError('OUTPUT_UPLOAD_CHANGED'));
      return;
    }
    if (!this.outputImporter) {
      this.sendJson(response, credentials, pending.requestId, 503, companionError('INTERNAL_ERROR'));
      return;
    }

    try {
      const imported = await this.outputImporter({
        handoff: pending.handoff,
        image: pending.image,
        sourceUrl: pending.sourceUrl,
        bytes: body,
      });
      this.sendJson(response, credentials, pending.requestId, 200, {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        ok: true,
        kind: 'output-imported',
        handoffId: pending.handoff.handoffId,
        ...imported,
      });
    } catch (reason) {
      console.error('[browser-companion] ChatGPT output import failed', reason);
      this.sendJson(response, credentials, pending.requestId, 500, companionError('INTERNAL_ERROR'));
    }
  }

  private async dispatch(envelope: BrowserCompanionLoopbackEnvelope): Promise<BrowserCompanionResponse> {
    const request = envelope.request;
    switch (request.kind) {
      case 'claim-handoff':
        if (request.target !== envelope.target) return companionError('TARGET_MISMATCH');
        return this.handoffs.claim(envelope.target, request.handoffId);
      case 'claim-latest':
        if (request.target !== envelope.target) return companionError('TARGET_MISMATCH');
        return this.handoffs.claim(envelope.target);
      case 'complete-handoff':
        return this.handoffs.complete(request.handoffId, request.completionToken, envelope.target);
      case 'release-handoff':
        return this.handoffs.release(request.handoffId, request.completionToken, envelope.target);
      case 'prepare-output-import':
        return this.prepareOutputImport(envelope);
      case 'read-media':
        return companionError('INVALID_REQUEST');
    }
  }

  private async sendMedia(
    response: ServerResponse,
    credentials: BrowserCompanionBridgeCredentials,
    envelope: BrowserCompanionLoopbackEnvelope,
  ): Promise<void> {
    if (envelope.request.kind !== 'read-media') {
      this.sendJson(response, credentials, envelope.requestId, 400, companionError('INVALID_REQUEST'));
      return;
    }
    const request = envelope.request;
    const opened = await this.handoffs.openMedia(
      request.handoffId,
      request.completionToken,
      request.mediaId,
      envelope.target,
    );
    if (opened.kind !== 'media-file') {
      this.sendJson(response, credentials, envelope.requestId, 404, opened);
      return;
    }

    const { handle, media } = opened;
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Content-Length', media.byteSize);
    response.setHeader(MEDIA_ID_HEADER, media.mediaId);
    response.setHeader(MEDIA_SIZE_HEADER, String(media.byteSize));
    response.setHeader(MEDIA_SHA256_HEADER, media.sha256);
    response.setHeader(MEDIA_MIME_TYPE_HEADER, media.mimeType);
    response.setHeader(
      BROWSER_COMPANION_RESPONSE_SIGNATURE_HEADER,
      hmac(credentials, mediaSignaturePayload(envelope.requestId, media)),
    );
    response.writeHead(200);
    const stream = handle.createReadStream({ autoClose: true, start: 0, end: media.byteSize - 1 });
    stream.once('error', (reason) => {
      console.error('[browser-companion] media stream failed', reason);
      response.destroy(reason);
    });
    stream.pipe(response);
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    credentials: BrowserCompanionBridgeCredentials,
  ): Promise<void> {
    if (!this.validLoopbackHost(request)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const pendingBootstrapId = bootstrapId(request.url);
    if (pendingBootstrapId) {
      this.sendBootstrap(request, response, pendingBootstrapId);
      return;
    }
    const origin = this.origin(request);
    if (!origin || !this.validRequestSurface(request)) {
      response.writeHead(403);
      response.end();
      return;
    }
    this.setCors(response, origin.value);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const uploadToken = outputImportToken(request.url);
    if (uploadToken) {
      await this.receiveOutputImport(request, response, credentials, origin.target, uploadToken);
      return;
    }
    if (request.method !== 'POST' || request.headers['content-type']?.split(';', 1)[0] !== REQUEST_CONTENT_TYPE) {
      response.writeHead(405);
      response.end();
      return;
    }

    const body = await readRequestBody(request);
    const signature = request.headers[BROWSER_COMPANION_REQUEST_SIGNATURE_HEADER];
    const rawSignature = Array.isArray(signature) ? undefined : signature;
    if (!body || !matchesHmac(credentials, body, rawSignature)) {
      response.writeHead(401);
      response.end();
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body.toString('utf8'));
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const parsed = browserCompanionLoopbackEnvelopeSchema.safeParse(parsedBody);
    if (!parsed.success) {
      response.writeHead(400);
      response.end();
      return;
    }
    const envelope = parsed.data;
    if (
      envelope.target !== origin.target ||
      Math.abs(Date.now() - envelope.sentAt) > BROWSER_COMPANION_REQUEST_CLOCK_SKEW_MS ||
      !this.consumeNonce(envelope)
    ) {
      this.sendJson(response, credentials, envelope.requestId, 403, companionError('UNAUTHORIZED'));
      return;
    }

    try {
      if (request.url === BROWSER_COMPANION_MEDIA_PATH) {
        await this.sendMedia(response, credentials, envelope);
        return;
      }
      if (envelope.request.kind === 'read-media') {
        this.sendJson(response, credentials, envelope.requestId, 400, companionError('INVALID_REQUEST'));
        return;
      }
      this.sendJson(response, credentials, envelope.requestId, 200, await this.dispatch(envelope));
    } catch (reason) {
      console.error('[browser-companion] request dispatch failed', reason);
      this.sendJson(response, credentials, envelope.requestId, 500, companionError('INTERNAL_ERROR'));
    }
  }
}
