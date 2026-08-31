import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEEPSEEK_PROVIDER, type DeepSeekProviderDefinition } from '@/main/assistant-models/deepseek-provider';
import { decodeProviderResponseJson } from '@/main/providers/provider-response';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { secretHint, validateApiSecret } from '@/main/extensions/secure-credentials';
import type { DeepSeekApiRuntimeConfiguration } from '@/main/extensions/deepseek-api/types';
import { validatedDeepSeekVisionSettings } from '@/main/extensions/deepseek-api/vision-endpoint';
import type { DeepSeekApiConnectionDto, DeepSeekApiConnectionStatus, DeepSeekApiSaveInput } from '@/shared/contracts';

const connectionStatusSchema = z.enum(['UNVERIFIED', 'READY', 'ERROR']) satisfies z.ZodType<
  Exclude<DeepSeekApiConnectionStatus, 'NOT_CONFIGURED'>
>;

const persistedConnectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    encryptedApiKey: z.string().min(1),
    apiKeyHint: z.string(),
    connectionStatus: connectionStatusSchema,
    connectionMessage: z.string(),
    updatedAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
    visionEndpoint: z.string().default(''),
    visionModelId: z.string().default(''),
  })
  .strict();

const modelsResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
  })
  .passthrough();

type PersistedConnection = z.infer<typeof persistedConnectionSchema>;

const CONNECTION_TIMEOUT_MS = 20_000;

function notConfigured(provider = DEEPSEEK_PROVIDER): DeepSeekApiConnectionDto {
  return {
    configured: false,
    status: 'NOT_CONFIGURED',
    message: 'DeepSeek API credentials are not configured',
    apiKeyHint: null,
    modelId: provider.modelId,
    visionEndpoint: '',
    visionModelId: '',
    updatedAt: null,
    lastVerifiedAt: null,
  };
}

function toDto(record: PersistedConnection, provider = DEEPSEEK_PROVIDER): DeepSeekApiConnectionDto {
  return {
    configured: true,
    status: record.connectionStatus,
    message: record.connectionMessage,
    apiKeyHint: record.apiKeyHint,
    modelId: provider.modelId,
    visionEndpoint: record.visionEndpoint,
    visionModelId: record.visionModelId,
    updatedAt: record.updatedAt,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

function providerError(status: number) {
  if (status === 401) return 'DeepSeek rejected the API key';
  if (status === 402) return 'DeepSeek account balance is insufficient';
  if (status === 403) return 'The API key cannot access DeepSeek models';
  if (status === 429) return 'DeepSeek rate limit was reached';
  return `DeepSeek connection failed with HTTP ${status}`;
}

class DeepSeekConnectionTestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DeepSeekConnectionTestError';
  }
}

/** App-global encrypted storage for the DeepSeek provider extension. */
export class DeepSeekApiConnection {
  private mutationRevision = 0;

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly provider: DeepSeekProviderDefinition = DEEPSEEK_PROVIDER,
  ) {}

  status(): DeepSeekApiConnectionDto {
    try {
      const record = this.readRecord();
      if (!record) return notConfigured(this.provider);
      this.decryptApiKey(record);
      return toDto(record, this.provider);
    } catch (error) {
      return {
        ...notConfigured(this.provider),
        configured: true,
        status: 'ERROR',
        message: error instanceof Error ? error.message : 'Stored DeepSeek API connection is invalid',
      };
    }
  }

  runtimeConfiguration(): DeepSeekApiRuntimeConfiguration | null {
    try {
      const record = this.readRecord();
      if (!record) return null;
      return {
        apiKey: this.decryptApiKey(record),
        modelId: this.provider.modelId,
        responsesUrl: this.provider.responsesUrl,
        visionEndpoint: record.visionEndpoint,
        visionModelId: record.visionModelId,
        configurationRevision: record.updatedAt,
        verified: record.connectionStatus === 'READY',
        connectionMessage: record.connectionMessage,
      };
    } catch {
      return null;
    }
  }

  async saveAndTest(input: DeepSeekApiSaveInput): Promise<DeepSeekApiConnectionDto> {
    if (!this.protector.isAvailable()) throw new Error('Secure credential storage is unavailable on this device');
    const existing = this.readRecord();
    const replacesApiKey = Boolean(input.apiKey.trim());
    const apiKey = replacesApiKey
      ? validateApiSecret(input.apiKey, 'DeepSeek API key')
      : existing
        ? this.decryptApiKey(existing)
        : (() => {
            throw new Error('DeepSeek API key is required');
          })();
    const timestamp = new Date().toISOString();
    const vision = validatedDeepSeekVisionSettings(input.visionEndpoint, input.visionModelId);
    const record: PersistedConnection = {
      schemaVersion: 1,
      encryptedApiKey: this.protector.protect(apiKey).toString('base64'),
      apiKeyHint: secretHint(apiKey),
      connectionStatus: !replacesApiKey && existing?.connectionStatus === 'READY' ? 'READY' : 'UNVERIFIED',
      connectionMessage:
        !replacesApiKey && existing?.connectionStatus === 'READY'
          ? existing.connectionMessage
          : 'Credentials saved; connection has not been verified',
      updatedAt: timestamp,
      lastVerifiedAt: existing?.lastVerifiedAt ?? null,
      ...vision,
    };
    const revision = ++this.mutationRevision;
    this.writeRecord(record);
    return this.testRecord(record, apiKey, revision);
  }

  async test() {
    const record = this.readRecord();
    if (!record) return notConfigured(this.provider);
    return this.testRecord(record, this.decryptApiKey(record), ++this.mutationRevision);
  }

  clear() {
    this.mutationRevision += 1;
    try {
      unlinkSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return notConfigured(this.provider);
  }

  private async testRecord(record: PersistedConnection, apiKey: string, revision: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
    let next: PersistedConnection;
    try {
      const response = await this.fetchImpl(this.provider.modelsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id');
      if (!response.ok) {
        throw new DeepSeekConnectionTestError(
          `${providerError(response.status)}${requestId ? ` (request ${requestId})` : ''}`,
          response.status,
        );
      }
      const body = await decodeProviderResponseJson(response, modelsResponseSchema, {
        provider: 'DeepSeek model catalog',
        maxBytes: 1024 * 1024,
      });
      if (!body.data.some((model) => model.id === this.provider.modelId)) {
        throw new Error(`DeepSeek model ${this.provider.modelId} is unavailable for this API key`);
      }
      const verifiedAt = new Date().toISOString();
      next = {
        ...record,
        connectionStatus: 'READY',
        connectionMessage: requestId ? `Connected · ${requestId}` : 'Connected',
        updatedAt: verifiedAt,
        lastVerifiedAt: verifiedAt,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'DeepSeek connection test timed out'
          : error instanceof Error
            ? error.message
            : 'DeepSeek connection test failed';
      const authenticationFailure =
        error instanceof DeepSeekConnectionTestError && (error.status === 401 || error.status === 403);
      next = {
        ...record,
        connectionStatus: authenticationFailure
          ? 'ERROR'
          : record.connectionStatus === 'READY'
            ? 'READY'
            : 'UNVERIFIED',
        connectionMessage: message,
        updatedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
    if (revision !== this.mutationRevision) return this.status();
    this.writeRecord(next);
    return toDto(next, this.provider);
  }

  private decryptApiKey(record: PersistedConnection) {
    if (!this.protector.isAvailable()) throw new Error('Secure credential storage is unavailable on this device');
    try {
      return validateApiSecret(
        this.protector.unprotect(Buffer.from(record.encryptedApiKey, 'base64')),
        'DeepSeek API key',
      );
    } catch {
      throw new Error('Stored DeepSeek API key cannot be decrypted on this device');
    }
  }

  private readRecord(): PersistedConnection | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const decoded = persistedConnectionSchema.safeParse(parsed);
      if (!decoded.success) throw new Error('Stored DeepSeek API connection is invalid');
      return {
        ...decoded.data,
        ...validatedDeepSeekVisionSettings(decoded.data.visionEndpoint, decoded.data.visionModelId),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private writeRecord(record: PersistedConnection) {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* no partial secret file remains */
      }
      throw error;
    }
  }
}
