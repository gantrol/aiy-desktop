import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import { secretHint, validateApiSecret } from '@/main/extensions/secure-credentials';
import {
  externalImageApiConfiguration,
  externalImageApiConnectionSettings,
  externalImageApiModelId,
  externalImageApiEndpointPermission,
  externalImageApiSettingsWithDefaults,
  normalizeExternalImageApiSettings,
  resolveExternalImageApiEndpoint,
} from '@/main/extensions/external-image-api/endpoints';
import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api/types';
import { decodeProviderResponseJson } from '@/main/providers/provider-response';
import type {
  ExternalImageApiConnectionDto,
  ExternalImageApiConnectionStatus,
  ExternalImageApiSaveInput,
} from '@/shared/contracts';
import {
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
  externalImageConnectionId,
  externalImageProviderId,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';

const extensionIdSchema = z.enum(EXTERNAL_IMAGE_API_EXTENSION_IDS);
const connectionStatusSchema = z.enum(['UNVERIFIED', 'READY', 'ERROR']) satisfies z.ZodType<
  Exclude<ExternalImageApiConnectionStatus, 'NOT_CONFIGURED'>
>;
const persistedConnectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    extensionId: extensionIdSchema,
    encryptedApiKey: z.string().min(1),
    apiKeyHint: z.string(),
    settings: z.record(z.string(), z.string()),
    connectionStatus: connectionStatusSchema,
    connectionMessage: z.string(),
    updatedAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
  })
  .strict();
const googleModelResponseSchema = z.object({ name: z.string().min(1) }).passthrough();

type PersistedConnection = z.infer<typeof persistedConnectionSchema>;

const CONNECTION_TIMEOUT_MS = 20_000;
const fileNames: Record<ExternalImageApiExtensionId, string> = {
  [GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID]: 'google-gemini-image-api.json',
  [ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID]: 'alibaba-model-studio-image-api.json',
  [VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID]: 'volcengine-ark-image-api.json',
};

function requireExtensionId(value: string): ExternalImageApiExtensionId {
  const decoded = extensionIdSchema.safeParse(value);
  if (!decoded.success) throw new Error(`Unknown external image API extension: ${value}`);
  return decoded.data;
}

function notConfigured(extensionId: ExternalImageApiExtensionId): ExternalImageApiConnectionDto {
  const settings = externalImageApiSettingsWithDefaults(extensionId, {});
  return {
    extensionId,
    connectionId: externalImageConnectionId(extensionId),
    providerId: externalImageProviderId(extensionId),
    modelId: externalImageApiModelId(extensionId, settings),
    configured: false,
    status: 'NOT_CONFIGURED',
    message: 'API credentials are not configured',
    apiKeyHint: null,
    connectionSettings: externalImageApiConnectionSettings(extensionId, settings),
    settings,
    updatedAt: null,
    lastVerifiedAt: null,
  };
}

function toDto(record: PersistedConnection): ExternalImageApiConnectionDto {
  const settings = externalImageApiSettingsWithDefaults(record.extensionId, record.settings);
  return {
    extensionId: record.extensionId,
    connectionId: externalImageConnectionId(record.extensionId),
    providerId: externalImageProviderId(record.extensionId),
    modelId: externalImageApiModelId(record.extensionId, settings),
    configured: true,
    status: record.connectionStatus,
    message: record.connectionMessage,
    apiKeyHint: record.apiKeyHint,
    connectionSettings: externalImageApiConnectionSettings(record.extensionId, settings),
    settings,
    updatedAt: record.updatedAt,
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

function providerErrorMessage(status: number) {
  if (status === 400) return 'The provider rejected the connection settings';
  if (status === 401) return 'The provider rejected the API key';
  if (status === 403) return 'The API key cannot access this image model';
  if (status === 404) return 'The configured image model is unavailable';
  if (status === 429) return 'The provider rate limit was reached';
  return `Connection test failed with HTTP ${status}`;
}

function sameSettings(left: Record<string, string> | undefined, right: Record<string, string>) {
  if (!left) return false;
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

class ExternalConnectionTestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ExternalConnectionTestError';
  }
}

/** App-global encrypted storage for external image-provider connections. */
export class ExternalImageApiConnections {
  private readonly mutationRevisions = new Map<ExternalImageApiExtensionId, number>();

  constructor(
    private readonly directory: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(rawExtensionId: string): ExternalImageApiConnectionDto {
    const extensionId = requireExtensionId(rawExtensionId);
    try {
      const record = this.readRecord(extensionId);
      if (!record) return notConfigured(extensionId);
      this.decryptApiKey(record);
      return toDto(record);
    } catch (error) {
      return {
        ...notConfigured(extensionId),
        configured: true,
        status: 'ERROR',
        message: error instanceof Error ? error.message : 'Stored API connection is invalid',
      };
    }
  }

  runtimeConfigurations(
    permissionGranted: (extensionId: ExternalImageApiExtensionId, permission: string) => boolean = () => true,
  ): ExternalImageApiRuntimeConfiguration[] {
    return EXTERNAL_IMAGE_API_EXTENSION_IDS.flatMap((extensionId) => {
      try {
        const record = this.readRecord(extensionId);
        if (!record) return [];
        const settings = normalizeExternalImageApiSettings(extensionId, record.settings);
        const endpointPermission = externalImageApiEndpointPermission(extensionId, settings);
        const endpointAuthorized = !endpointPermission || permissionGranted(extensionId, endpointPermission);
        return [
          {
            extensionId,
            apiKey: this.decryptApiKey(record),
            settings,
            usable: record.connectionStatus !== 'ERROR' && endpointAuthorized,
            verified: record.connectionStatus === 'READY',
            connectionMessage: endpointAuthorized
              ? record.connectionMessage
              : `Grant extension permission ${endpointPermission} to use this endpoint`,
          },
        ];
      } catch {
        return [];
      }
    });
  }

  endpointPermission(rawExtensionId: string) {
    const extensionId = requireExtensionId(rawExtensionId);
    try {
      const record = this.readRecord(extensionId);
      if (!record) return null;
      return externalImageApiEndpointPermission(extensionId, record.settings);
    } catch {
      // status() reports the malformed record. Listing extensions must remain
      // available so the user can clear or replace that configuration.
      return null;
    }
  }

  async saveAndTest(input: ExternalImageApiSaveInput) {
    const extensionId = requireExtensionId(input.extensionId);
    if (!this.protector.isAvailable()) throw new Error('Secure credential storage is unavailable on this device');
    const existing = this.readRecord(extensionId);
    const replacesApiKey = Boolean(input.apiKey.trim());
    const apiKey = replacesApiKey
      ? validateApiSecret(input.apiKey)
      : existing
        ? this.decryptApiKey(existing)
        : (() => {
            throw new Error('API key is required');
          })();
    const timestamp = new Date().toISOString();
    const settings = normalizeExternalImageApiSettings(extensionId, input.settings);
    const connectionChanged =
      replacesApiKey ||
      !sameSettings(
        existing ? externalImageApiConnectionSettings(extensionId, existing.settings) : undefined,
        externalImageApiConnectionSettings(extensionId, settings),
      );
    const record: PersistedConnection = {
      schemaVersion: 1,
      extensionId,
      encryptedApiKey: this.protector.protect(apiKey).toString('base64'),
      apiKeyHint: secretHint(apiKey),
      settings,
      connectionStatus: !connectionChanged && existing?.connectionStatus === 'READY' ? 'READY' : 'UNVERIFIED',
      connectionMessage:
        !connectionChanged && existing?.connectionStatus === 'READY'
          ? existing.connectionMessage
          : 'Credentials saved; connection has not been verified',
      updatedAt: timestamp,
      lastVerifiedAt: connectionChanged ? null : (existing?.lastVerifiedAt ?? null),
    };
    const revision = this.nextMutationRevision(extensionId);
    this.writeRecord(record);
    return this.testRecord(record, apiKey, connectionChanged, revision);
  }

  async test(rawExtensionId: string) {
    const extensionId = requireExtensionId(rawExtensionId);
    const record = this.readRecord(extensionId);
    if (!record) return notConfigured(extensionId);
    return this.testRecord(record, this.decryptApiKey(record), false, this.nextMutationRevision(extensionId));
  }

  clear(rawExtensionId: string) {
    const extensionId = requireExtensionId(rawExtensionId);
    this.nextMutationRevision(extensionId);
    try {
      unlinkSync(this.filePath(extensionId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return notConfigured(extensionId);
  }

  markVerified(rawExtensionId: string, requestId?: string | null) {
    const extensionId = requireExtensionId(rawExtensionId);
    this.nextMutationRevision(extensionId);
    const record = this.readRecord(extensionId);
    if (!record) return notConfigured(extensionId);
    this.decryptApiKey(record);
    if (record.connectionStatus === 'READY') return toDto(record);
    const verifiedAt = new Date().toISOString();
    const next: PersistedConnection = {
      ...record,
      connectionStatus: 'READY',
      connectionMessage: requestId ? `Verified by generation · ${requestId}` : 'Verified by successful generation',
      updatedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
    };
    this.writeRecord(next);
    return toDto(next);
  }

  markConnectionError(rawExtensionId: string, message: string) {
    const extensionId = requireExtensionId(rawExtensionId);
    this.nextMutationRevision(extensionId);
    const record = this.readRecord(extensionId);
    if (!record) return notConfigured(extensionId);
    this.decryptApiKey(record);
    const next: PersistedConnection = {
      ...record,
      connectionStatus: 'ERROR',
      connectionMessage: message.trim().slice(0, 1_000) || 'Provider rejected the API credentials',
      updatedAt: new Date().toISOString(),
    };
    this.writeRecord(next);
    return toDto(next);
  }

  private async testRecord(
    record: PersistedConnection,
    apiKey: string,
    connectionWasChanged: boolean,
    revision: number,
  ) {
    const resolved = resolveExternalImageApiEndpoint(record.extensionId, record.settings);
    const configuration = externalImageApiConfiguration(record.extensionId);
    if (
      record.extensionId !== GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID ||
      !configuration.connectionCheckPresetIds.includes(resolved.endpointPresetId)
    ) {
      if (!connectionWasChanged) return toDto(record);
      const next: PersistedConnection = {
        ...record,
        connectionStatus: 'UNVERIFIED',
        connectionMessage: 'Configuration saved; provider access will be verified by the first generation',
        updatedAt: new Date().toISOString(),
      };
      if (!this.isCurrentRevision(record.extensionId, revision)) return this.status(record.extensionId);
      this.writeRecord(next);
      return toDto(next);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
    let next: PersistedConnection;
    try {
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolved.modelId)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
        },
      );
      const requestId = response.headers.get('x-request-id') || response.headers.get('x-guploader-uploadid');
      if (!response.ok) {
        throw new ExternalConnectionTestError(
          `${providerErrorMessage(response.status)}${requestId ? ` (request ${requestId})` : ''}`,
          response.status,
        );
      }
      const model = await decodeProviderResponseJson(response, googleModelResponseSchema, {
        provider: 'Google model catalog',
        maxBytes: 1024 * 1024,
      });
      if (model.name !== `models/${resolved.modelId}`) throw new Error('Google returned an unexpected model response');
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
          ? 'Connection test timed out'
          : error instanceof Error
            ? error.message
            : 'Connection test failed';
      const authenticationFailure =
        error instanceof ExternalConnectionTestError && (error.status === 401 || error.status === 403);
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
    if (!this.isCurrentRevision(record.extensionId, revision)) return this.status(record.extensionId);
    this.writeRecord(next);
    return toDto(next);
  }

  private decryptApiKey(record: PersistedConnection) {
    if (!this.protector.isAvailable()) throw new Error('Secure credential storage is unavailable on this device');
    try {
      return validateApiSecret(this.protector.unprotect(Buffer.from(record.encryptedApiKey, 'base64')));
    } catch {
      throw new Error('Stored API key cannot be decrypted on this device');
    }
  }

  private nextMutationRevision(extensionId: ExternalImageApiExtensionId) {
    const revision = (this.mutationRevisions.get(extensionId) ?? 0) + 1;
    this.mutationRevisions.set(extensionId, revision);
    return revision;
  }

  private isCurrentRevision(extensionId: ExternalImageApiExtensionId, revision: number) {
    return this.mutationRevisions.get(extensionId) === revision;
  }

  private readRecord(extensionId: ExternalImageApiExtensionId): PersistedConnection | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath(extensionId), 'utf8'));
      const decoded = persistedConnectionSchema.safeParse(parsed);
      if (!decoded.success || decoded.data.extensionId !== extensionId) {
        throw new Error('Stored API connection is invalid');
      }
      return decoded.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private writeRecord(record: PersistedConnection) {
    mkdirSync(this.directory, { recursive: true });
    const target = this.filePath(record.extensionId);
    const temporary = path.join(this.directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, target);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        /* no partial credential file remains */
      }
      throw error;
    }
  }

  private filePath(extensionId: ExternalImageApiExtensionId) {
    return path.join(this.directory, fileNames[extensionId]);
  }
}
