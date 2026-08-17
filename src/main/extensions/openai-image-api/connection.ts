import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OPENAI_IMAGE_PROVIDER } from '@/main/extensions/openai-image-api/definition';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import type { OpenAiImageApiRuntimeConfiguration } from '@/main/extensions/openai-image-api/types';
import { decodeProviderResponseJson, tryDecodeProviderErrorJson } from '@/main/providers/provider-response';
import type {
  OpenAiImageApiConnectionDto,
  OpenAiImageApiConnectionStatus,
  OpenAiImageApiSaveInput,
} from '@/shared/contracts';
import { OPENAI_IMAGE_CONNECTION_ID, OPENAI_IMAGE_PROVIDER_KEY } from '@/shared/extension-ids';

const connectionStatusSchema = z.enum(['UNVERIFIED', 'READY', 'ERROR']) satisfies z.ZodType<
  Exclude<OpenAiImageApiConnectionStatus, 'NOT_CONFIGURED'>
>;
const persistedConnectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    encryptedApiKey: z.string().min(1),
    apiKeyHint: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    moderation: z.enum(['auto', 'low']),
    connectionStatus: connectionStatusSchema,
    connectionMessage: z.string(),
    updatedAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
  })
  .strict();
const modelResponseSchema = z.object({ id: z.string().min(1) }).passthrough();
const apiErrorResponseSchema = z
  .object({ error: z.object({ message: z.string().optional() }).passthrough() })
  .passthrough();

type PersistedConnection = z.infer<typeof persistedConnectionSchema>;

type FetchLike = typeof fetch;

const CONNECTION_TIMEOUT_MS = 20_000;

function normalizedOptionalId(value: string, field: string) {
  const normalized = value.trim();
  if (normalized.length > 200) throw new Error(`${field} is too long`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${field} contains an invalid line break`);
  return normalized;
}

function apiKeyHint(apiKey: string) {
  return `••••••••${apiKey.slice(-4)}`;
}

function validateApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 20 || normalized.length > 500 || /\s/.test(normalized)) {
    throw new Error('OpenAI API key is invalid');
  }
  return normalized;
}

function connectionDto(record: PersistedConnection): OpenAiImageApiConnectionDto {
  return {
    connectionId: OPENAI_IMAGE_CONNECTION_ID,
    providerId: OPENAI_IMAGE_PROVIDER_KEY,
    modelId: OPENAI_IMAGE_PROVIDER.modelId,
    configured: true,
    status: record.connectionStatus,
    message: record.connectionMessage,
    apiKeyHint: record.apiKeyHint,
    organizationId: record.organizationId,
    projectId: record.projectId,
    moderation: record.moderation,
    updatedAt: record.updatedAt,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

function notConfigured(): OpenAiImageApiConnectionDto {
  return {
    connectionId: OPENAI_IMAGE_CONNECTION_ID,
    providerId: OPENAI_IMAGE_PROVIDER_KEY,
    modelId: OPENAI_IMAGE_PROVIDER.modelId,
    configured: false,
    status: 'NOT_CONFIGURED',
    message: 'OpenAI API credentials are not configured',
    apiKeyHint: null,
    organizationId: '',
    projectId: '',
    moderation: 'auto',
    updatedAt: null,
    lastVerifiedAt: null,
  };
}

/** App-global connection store. The API key is never written without OS encryption. */
export class OpenAiImageApiConnection {
  private mutationRevision = 0;

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): OpenAiImageApiConnectionDto {
    try {
      const record = this.readRecord();
      if (!record) return notConfigured();
      this.decryptApiKey(record);
      return connectionDto(record);
    } catch (error) {
      return {
        ...notConfigured(),
        configured: true,
        status: 'ERROR',
        message: error instanceof Error ? error.message : 'Stored OpenAI API connection is invalid',
      };
    }
  }

  runtimeConfiguration(): OpenAiImageApiRuntimeConfiguration | null {
    try {
      const record = this.readRecord();
      if (!record) return null;
      return {
        apiKey: this.decryptApiKey(record),
        organizationId: record.organizationId || null,
        projectId: record.projectId || null,
        moderation: record.moderation,
        usable: record.connectionStatus !== 'ERROR',
        verified: record.connectionStatus === 'READY',
        connectionMessage: record.connectionMessage,
      };
    } catch {
      return null;
    }
  }

  changesRequestCredentials(input: OpenAiImageApiSaveInput) {
    if (input.apiKey.trim()) return true;
    const existing = this.readRecord();
    if (!existing) return true;
    return (
      existing.organizationId !== normalizedOptionalId(input.organizationId, 'Organization ID') ||
      existing.projectId !== normalizedOptionalId(input.projectId, 'Project ID')
    );
  }

  save(input: OpenAiImageApiSaveInput): OpenAiImageApiConnectionDto {
    if (!this.protector.isAvailable()) {
      throw new Error('Secure credential storage is unavailable on this device');
    }
    const submittedApiKey = input.apiKey.trim();
    // A complete replacement does not depend on the previous local record.
    // This also lets Save recover from malformed development configuration.
    const existing = submittedApiKey ? null : this.readRecord();
    const replacementApiKey = submittedApiKey ? validateApiKey(submittedApiKey) : null;
    if (!replacementApiKey && !existing) throw new Error('OpenAI API key is required');
    const timestamp = new Date().toISOString();
    const organizationId = normalizedOptionalId(input.organizationId, 'Organization ID');
    const projectId = normalizedOptionalId(input.projectId, 'Project ID');
    const connectionChanged =
      Boolean(submittedApiKey) || existing?.organizationId !== organizationId || existing?.projectId !== projectId;
    const record: PersistedConnection = {
      schemaVersion: 1,
      encryptedApiKey: replacementApiKey
        ? this.protector.protect(replacementApiKey).toString('base64')
        : existing!.encryptedApiKey,
      apiKeyHint: replacementApiKey ? apiKeyHint(replacementApiKey) : existing!.apiKeyHint,
      organizationId,
      projectId,
      moderation: input.moderation,
      connectionStatus: connectionChanged ? 'UNVERIFIED' : existing!.connectionStatus,
      connectionMessage: connectionChanged
        ? 'Credentials saved; connection has not been verified'
        : existing!.connectionMessage,
      updatedAt: timestamp,
      lastVerifiedAt: connectionChanged ? null : existing!.lastVerifiedAt,
    };
    this.mutationRevision += 1;
    this.writeRecord(record);
    return connectionDto(record);
  }

  async test(): Promise<OpenAiImageApiConnectionDto> {
    const record = this.readRecord();
    if (!record) return notConfigured();
    return this.testRecord(record, this.decryptApiKey(record), ++this.mutationRevision);
  }

  clear(): OpenAiImageApiConnectionDto {
    this.mutationRevision += 1;
    try {
      unlinkSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return notConfigured();
  }

  markVerified(requestId?: string | null) {
    this.mutationRevision += 1;
    const record = this.readRecord();
    if (!record) return notConfigured();
    this.decryptApiKey(record);
    if (record.connectionStatus === 'READY') return connectionDto(record);
    const verifiedAt = new Date().toISOString();
    const next: PersistedConnection = {
      ...record,
      connectionStatus: 'READY',
      connectionMessage: requestId ? `Verified by generation · ${requestId}` : 'Verified by successful generation',
      updatedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
    };
    this.writeRecord(next);
    return connectionDto(next);
  }

  markConnectionError(message: string) {
    this.mutationRevision += 1;
    const record = this.readRecord();
    if (!record) return notConfigured();
    this.decryptApiKey(record);
    const next: PersistedConnection = {
      ...record,
      connectionStatus: 'ERROR',
      connectionMessage: message.trim().slice(0, 1_000) || 'OpenAI rejected the API credentials',
      updatedAt: new Date().toISOString(),
    };
    this.writeRecord(next);
    return connectionDto(next);
  }

  private async testRecord(record: PersistedConnection, apiKey: string, revision: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
    let next: PersistedConnection;
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      if (record.organizationId) headers['OpenAI-Organization'] = record.organizationId;
      if (record.projectId) headers['OpenAI-Project'] = record.projectId;
      const response = await this.fetchImpl(OPENAI_IMAGE_PROVIDER.modelUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      const requestId = response.headers.get('x-request-id');
      if (response.status === 401) {
        const message = await this.readApiError(response);
        next = {
          ...record,
          connectionStatus: 'ERROR',
          connectionMessage: `${message}${requestId ? ` (request ${requestId})` : ''}`,
          updatedAt: new Date().toISOString(),
        };
      } else if (!response.ok) {
        const message = await this.readApiError(response);
        next = this.advisoryResult(
          record,
          `Model access check unavailable: ${message}${requestId ? ` (request ${requestId})` : ''}; image generation will verify access`,
        );
      } else {
        const model = await decodeProviderResponseJson(response, modelResponseSchema, {
          provider: 'OpenAI model catalog',
          maxBytes: 1024 * 1024,
        });
        next = this.advisoryResult(
          record,
          model.id === OPENAI_IMAGE_PROVIDER.modelId
            ? requestId
              ? `Model metadata access confirmed · ${requestId}; image generation will verify image access`
              : 'Model metadata access confirmed; image generation will verify image access'
            : 'Model access check returned an unexpected response; image generation will verify access',
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'OpenAI connection test timed out'
          : error instanceof Error
            ? error.message
            : 'OpenAI connection test failed';
      next = this.advisoryResult(record, `${message}; image generation will verify access`);
    } finally {
      clearTimeout(timeout);
    }
    if (revision !== this.mutationRevision) return this.status();
    this.writeRecord(next);
    return connectionDto(next);
  }

  private advisoryResult(record: PersistedConnection, message: string): PersistedConnection {
    // Reading model metadata and creating images are separately restrictable
    // API-key permissions. Only a real image request can verify image access.
    if (record.connectionStatus === 'READY') return record;
    return {
      ...record,
      connectionStatus: 'UNVERIFIED',
      connectionMessage: message.slice(0, 1_000),
      updatedAt: new Date().toISOString(),
    };
  }

  private async readApiError(response: Response) {
    try {
      const body = await tryDecodeProviderErrorJson(response, apiErrorResponseSchema, 'OpenAI model catalog');
      if (body?.error.message?.trim()) {
        return body.error.message.trim().slice(0, 500);
      }
    } catch {
      // Use the stable status fallback below.
    }
    if (response.status === 401) return 'OpenAI rejected the API key';
    if (response.status === 403) return 'The API key cannot access GPT Image 2';
    if (response.status === 429) return 'OpenAI rate limit reached';
    return `OpenAI connection failed with HTTP ${response.status}`;
  }

  private decryptApiKey(record: PersistedConnection) {
    if (!this.protector.isAvailable()) {
      throw new Error('Secure credential storage is unavailable on this device');
    }
    try {
      return validateApiKey(this.protector.unprotect(Buffer.from(record.encryptedApiKey, 'base64')));
    } catch {
      throw new Error('Stored OpenAI API key cannot be decrypted on this device');
    }
  }

  private readRecord(): PersistedConnection | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const decoded = persistedConnectionSchema.safeParse(parsed);
      if (!decoded.success) throw new Error('Stored OpenAI API connection is invalid');
      return decoded.data;
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
