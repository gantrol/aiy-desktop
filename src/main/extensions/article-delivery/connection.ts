import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import type { ArticleDeliveryDefinition } from '@/main/extensions/article-delivery/definition';
import {
  articleDeliveryArticleProfileSaveInputSchema,
  articleDeliveryArticleProfileSchema,
  articleDeliveryConnectionDtoSchema,
  articleDeliveryConnectionSaveInputSchema,
  articleDeliveryExtensionTargetSchema,
  articleDeliveryMode,
  type ArticleDeliveryMode,
  type ArticleDeliveryArticleProfile,
  type ArticleDeliveryArticleProfileSaveInput,
  type ArticleDeliveryArticleTarget,
  type ArticleDeliveryConnectionDto,
  type ArticleDeliveryConnectionSaveInput,
} from '@/shared/contracts/article-delivery';

const MAX_CONNECTION_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 256_000;

const persistedProfileSchema = articleDeliveryArticleProfileSchema.omit({
  extensionId: true,
  channelId: true,
  spaceId: true,
  articleId: true,
});
const persistedConnectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    channelId: articleDeliveryExtensionTargetSchema.shape.channelId,
    endpointId: z.string().trim().min(3).max(160),
    siteUrl: z.string().url().max(500),
    encryptedToken: z.string().min(1).max(1_000),
    tokenHint: z.string().min(1).max(20),
    connectionState: z.enum(['UNVERIFIED', 'READY', 'ERROR']),
    connectionMessage: z.string().max(500),
    connectionErrorCode: z.string().max(160).nullable().optional(),
    lastVerifiedAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    profiles: z.record(z.string().max(500), persistedProfileSchema),
  })
  .strict();

const statusEnvelopeSchema = z.union([
  z
    .object({
      data: z
        .object({
          protocol: z.literal('aiy-article-import'),
          version: z.literal(1),
          capabilities: z
            .object({ documentModes: z.array(z.string().max(80)).max(20) })
            .passthrough()
            .optional(),
        })
        .passthrough(),
      meta: z.object({ version: z.string(), updatedAt: z.string() }).passthrough(),
    })
    .strict(),
  z
    .object({
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    })
    .strict(),
]);

type PersistedConnection = z.infer<typeof persistedConnectionSchema>;

function validateToken(value: string) {
  const token = value.trim();
  if (token.length < 32 || token.length > 500 || /\s/u.test(token)) throw new Error('Delivery token is invalid');
  return token;
}

function profileKey(input: ArticleDeliveryArticleTarget) {
  return `${encodeURIComponent(input.spaceId)}:${encodeURIComponent(input.articleId)}`;
}

function endpointFor(definition: ArticleDeliveryDefinition, endpointId: string) {
  const endpoint = definition.configuration.endpoints.find((candidate) => candidate.id === endpointId);
  if (!endpoint) throw new Error('Delivery endpoint is unavailable');
  return endpoint;
}

export async function readArticleDeliveryJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Delivery response exceeded the size limit');
  }
  if (!response.body) throw new Error('Delivery response was empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Delivery response exceeded the size limit');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Delivery endpoint returned invalid JSON');
  }
}

export class ArticleDeliveryConnection {
  private record: PersistedConnection | null = null;
  private loadError: string | null = null;
  private mutationRevision = 0;

  constructor(
    readonly extensionId: string,
    private readonly filePath: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initialize() {
    try {
      const metadata = await stat(this.filePath);
      if (!metadata.isFile() || metadata.size > MAX_CONNECTION_BYTES) throw new Error('Connection file is invalid');
      const raw = await readFile(this.filePath, 'utf8');
      const record = persistedConnectionSchema.parse(JSON.parse(raw) as unknown);
      this.decryptToken(record);
      this.record = record;
      this.loadError = null;
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') {
        this.record = null;
        this.loadError = null;
        return;
      }
      this.record = null;
      this.loadError = reason instanceof Error ? reason.message : 'Stored delivery connection is invalid';
    }
  }

  extensionStatus() {
    if (this.loadError) return { configured: true, ready: false, message: this.loadError };
    if (!this.record) return { configured: false, ready: false, message: 'Delivery connection is not configured' };
    return {
      configured: true,
      ready: this.record.connectionState === 'READY',
      message: this.record.connectionMessage,
    };
  }

  status(definition: ArticleDeliveryDefinition): ArticleDeliveryConnectionDto {
    const target = { extensionId: definition.extensionId, channelId: definition.channelId };
    if (this.loadError) {
      return articleDeliveryConnectionDtoSchema.parse({
        ...target,
        configured: true,
        state: 'ERROR',
        endpointId: null,
        siteUrl: null,
        tokenHint: null,
        message: this.loadError,
        lastVerifiedAt: null,
      });
    }
    if (!this.record) {
      return articleDeliveryConnectionDtoSchema.parse({
        ...target,
        configured: false,
        state: 'NOT_CONFIGURED',
        endpointId: null,
        siteUrl: null,
        tokenHint: null,
        message: 'Delivery connection is not configured',
        lastVerifiedAt: null,
      });
    }
    const endpoint = definition.configuration.endpoints.find((candidate) => candidate.id === this.record?.endpointId);
    const definitionMatches =
      this.record.channelId === definition.channelId && endpoint?.siteUrl === this.record.siteUrl;
    return articleDeliveryConnectionDtoSchema.parse({
      ...target,
      configured: true,
      state: definitionMatches ? this.record.connectionState : 'ERROR',
      endpointId: this.record.endpointId,
      siteUrl: this.record.siteUrl,
      tokenHint: this.record.tokenHint,
      message: definitionMatches ? this.record.connectionMessage : 'Delivery extension configuration changed',
      errorCode: this.record.connectionErrorCode ?? null,
      lastVerifiedAt: this.record.lastVerifiedAt,
    });
  }

  configuration(definition: ArticleDeliveryDefinition) {
    if (!this.record) throw new Error(this.loadError || 'Delivery connection is not configured');
    const endpoint = endpointFor(definition, this.record.endpointId);
    if (this.record.channelId !== definition.channelId || endpoint.siteUrl !== this.record.siteUrl) {
      throw new Error('Delivery extension configuration changed');
    }
    return Object.freeze({ siteUrl: endpoint.siteUrl, token: this.decryptToken(this.record) });
  }

  articleProfile(input: ArticleDeliveryArticleTarget): ArticleDeliveryArticleProfile | null {
    const profile = this.record?.profiles[profileKey(input)];
    if (!profile) return null;
    return articleDeliveryArticleProfileSchema.parse({
      extensionId: input.extensionId,
      channelId: input.channelId,
      spaceId: input.spaceId,
      articleId: input.articleId,
      ...profile,
    });
  }

  async saveArticleProfile(definition: ArticleDeliveryDefinition, rawInput: ArticleDeliveryArticleProfileSaveInput) {
    const input = articleDeliveryArticleProfileSaveInputSchema.parse(rawInput);
    this.configuration(definition);
    if (!this.record) throw new Error('Delivery connection is not configured');
    const updatedAt = new Date().toISOString();
    const profile = articleDeliveryArticleProfileSchema.parse({
      ...input,
      canonicalPath: `${definition.configuration.pathPrefix}${input.slug}`,
      updatedAt,
    });
    const next: PersistedConnection = {
      ...this.record,
      updatedAt,
      profiles: {
        ...this.record.profiles,
        [profileKey(input)]: {
          slug: profile.slug,
          canonicalPath: profile.canonicalPath,
          description: profile.description,
          updatedAt: profile.updatedAt,
        },
      },
    };
    await this.persist(next);
    this.record = next;
    return profile;
  }

  async saveAndTest(
    definition: ArticleDeliveryDefinition,
    rawInput: ArticleDeliveryConnectionSaveInput,
    assertAccess?: () => void,
  ) {
    assertAccess?.();
    if (!this.protector.isAvailable()) throw new Error('Secure credential storage is unavailable on this device');
    const input = articleDeliveryConnectionSaveInputSchema.parse(rawInput);
    const endpoint = endpointFor(definition, input.endpointId);
    const token = input.token.trim()
      ? validateToken(input.token)
      : this.record
        ? this.decryptToken(this.record)
        : (() => {
            throw new Error('Delivery token is required');
          })();
    const updatedAt = new Date().toISOString();
    const next: PersistedConnection = {
      schemaVersion: 1,
      channelId: definition.channelId,
      endpointId: endpoint.id,
      siteUrl: endpoint.siteUrl,
      encryptedToken: this.protector.protect(token).toString('base64'),
      tokenHint: `••••••••${token.slice(-4)}`,
      connectionState: 'UNVERIFIED',
      connectionMessage: 'Delivery connection has not been verified',
      connectionErrorCode: null,
      lastVerifiedAt: this.record?.lastVerifiedAt ?? null,
      updatedAt,
      profiles: this.record?.profiles ?? {},
    };
    const revision = ++this.mutationRevision;
    await this.persist(next);
    this.record = next;
    this.loadError = null;
    return this.verifyRecord(definition, next, token, revision, assertAccess);
  }

  async test(definition: ArticleDeliveryDefinition, assertAccess?: () => void) {
    assertAccess?.();
    if (!this.record) return this.status(definition);
    this.configuration(definition);
    return this.verifyRecord(
      definition,
      this.record,
      this.decryptToken(this.record),
      ++this.mutationRevision,
      assertAccess,
    );
  }

  async clear(definition: ArticleDeliveryDefinition) {
    this.mutationRevision += 1;
    await rm(this.filePath, { force: true });
    this.record = null;
    this.loadError = null;
    return this.status(definition);
  }

  async verifySupport(
    configuration: Readonly<{ siteUrl: string; token: string }>,
    mode: ArticleDeliveryMode,
    assertAccess?: () => void,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    assertAccess?.();
    const response = await this.fetchImpl(`${configuration.siteUrl}/api/integrations/aiy/status`, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json', authorization: `Bearer ${configuration.token}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    const parsed = statusEnvelopeSchema.safeParse(await readArticleDeliveryJsonResponse(response));
    if (!parsed.success) {
      throw Object.assign(new Error('DELIVERY_STATUS_INVALID'), { code: 'DELIVERY_STATUS_INVALID' });
    }
    const envelope = parsed.data;
    if ('error' in envelope) {
      throw Object.assign(new Error(envelope.error.message), { code: envelope.error.code, status: response.status });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Delivery connection failed (${response.status})`), { status: response.status });
    }
    if (mode === 'DRAFT' && !envelope.data.capabilities?.documentModes.includes('draft')) {
      throw Object.assign(new Error('DELIVERY_DRAFT_UNSUPPORTED'), { code: 'DELIVERY_DRAFT_UNSUPPORTED' });
    }
    signal?.throwIfAborted();
    assertAccess?.();
  }

  private async verifyRecord(
    definition: ArticleDeliveryDefinition,
    record: PersistedConnection,
    token: string,
    revision: number,
    assertAccess?: () => void,
  ) {
    let next: PersistedConnection;
    try {
      await this.verifySupport(
        { siteUrl: record.siteUrl, token },
        articleDeliveryMode(definition.configuration),
        assertAccess,
      );
      next = {
        ...record,
        connectionState: 'READY',
        connectionMessage: 'Delivery connection is ready',
        connectionErrorCode: null,
        lastVerifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (reason) {
      next = {
        ...record,
        connectionState: 'ERROR',
        connectionMessage: reason instanceof Error ? reason.message.slice(0, 500) : 'Delivery connection failed',
        connectionErrorCode:
          reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string'
            ? reason.code.slice(0, 160)
            : null,
        updatedAt: new Date().toISOString(),
      };
    }
    if (revision === this.mutationRevision) {
      await this.persist(next);
      this.record = next;
    }
    return this.status(definition);
  }

  private decryptToken(record: PersistedConnection) {
    try {
      return validateToken(this.protector.unprotect(Buffer.from(record.encryptedToken, 'base64')));
    } catch {
      throw new Error('Stored delivery token cannot be decrypted on this device');
    }
  }

  private async persist(record: PersistedConnection) {
    const serialized = JSON.stringify(persistedConnectionSchema.parse(record));
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONNECTION_BYTES)
      throw new Error('Delivery connection is too large');
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporaryPath, this.filePath);
      } catch {
        await rm(this.filePath, { force: true });
        await rename(temporaryPath, this.filePath);
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export class ArticleDeliveryConnections {
  private readonly connections = new Map<string, Promise<ArticleDeliveryConnection>>();
  private readonly readyConnections = new Map<string, ArticleDeliveryConnection>();

  constructor(
    private readonly directoryPath: string,
    private readonly protector: SecretProtector,
  ) {}

  get(rawExtensionId: string) {
    const extensionId = articleDeliveryExtensionTargetSchema.shape.extensionId.parse(rawExtensionId);
    const existing = this.connections.get(extensionId);
    if (existing) return existing;
    const created = (async () => {
      const connection = new ArticleDeliveryConnection(
        extensionId,
        path.join(this.directoryPath, `${extensionId}.json`),
        this.protector,
      );
      await connection.initialize();
      this.readyConnections.set(extensionId, connection);
      return connection;
    })();
    this.connections.set(extensionId, created);
    return created;
  }

  async initialize(extensionIds: readonly string[]) {
    await Promise.all(extensionIds.map((extensionId) => this.get(extensionId)));
  }

  extensionStatus(extensionId: string) {
    return (
      this.readyConnections.get(extensionId)?.extensionStatus() ?? {
        configured: false,
        ready: false,
        message: 'Delivery connection is not configured',
      }
    );
  }
}
