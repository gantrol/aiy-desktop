import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api/types';
import { secretHint, validateApiSecret, type SecretProtector } from '@/main/extensions/secure-credentials';
import { decodeProviderResponseJson } from '@/main/providers/provider-response';
import { CPA_IMAGE_CONNECTION_ID, CPA_IMAGE_API_EXTENSION_ID, CPA_IMAGE_PROVIDER_KEY } from '@/shared/extension-ids';
import type { ProviderConnectionDto, ProviderConnectionSaveInput } from '@/shared/contracts/provider-connections';
import {
  CPA_IMAGE_DEFAULT_BASE_URL,
  cpaImageEndpointPermission,
  validatedCpaImageBaseUrl,
} from '@/main/extensions/cpa-image/endpoint';

const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    encryptedApiKey: z.string().min(1),
    apiKeyHint: z.string(),
    baseUrl: z.string(),
    state: z.enum(['UNVERIFIED', 'READY', 'ERROR']),
    message: z.string(),
    updatedAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
  })
  .strict();
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough();
type Record = z.infer<typeof recordSchema>;

const actions: ProviderConnectionDto['supportedActions'] = ['SAVE', 'VERIFY', 'REMOVE'];

export class CpaImageConnection {
  private record: Record | null = null;
  private loadError: string | null = null;
  private revision = 0;

  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.record = recordSchema.parse(JSON.parse(raw));
      validatedCpaImageBaseUrl(this.record.baseUrl);
      this.decrypt(this.record);
      this.loadError = null;
    } catch (error) {
      this.record = null;
      this.loadError =
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'CPA_IMAGE_STORED_CONNECTION_INVALID';
    }
  }

  status(): ProviderConnectionDto {
    const record = this.record;
    return {
      connectionId: CPA_IMAGE_CONNECTION_ID,
      providerId: CPA_IMAGE_PROVIDER_KEY,
      extensionId: CPA_IMAGE_API_EXTENSION_ID,
      kind: 'AGENT_BACKEND',
      configured: Boolean(record || this.loadError),
      connectionState: this.loadError ? 'ERROR' : (record?.state ?? 'NOT_CONFIGURED'),
      message: this.loadError ?? record?.message ?? 'CPA_IMAGE_NOT_CONFIGURED',
      credentialHint: record?.apiKeyHint ?? null,
      modelId: null,
      settings: { baseUrl: record?.baseUrl ?? CPA_IMAGE_DEFAULT_BASE_URL },
      supportedActions: [...actions],
      updatedAt: record?.updatedAt ?? null,
      lastVerifiedAt: record?.lastVerifiedAt ?? null,
    };
  }

  endpointPermission() {
    return this.record ? cpaImageEndpointPermission(this.record.baseUrl) : null;
  }

  runtimeConfiguration(): ExternalImageApiRuntimeConfiguration | null {
    const record = this.record;
    if (!record || this.loadError) return null;
    return {
      extensionId: CPA_IMAGE_API_EXTENSION_ID,
      apiKey: this.decrypt(record),
      settings: { baseUrl: record.baseUrl },
      usable: record.state !== 'ERROR',
      verified: record.state === 'READY',
      connectionMessage: record.message,
    };
  }

  async save(input: ProviderConnectionSaveInput) {
    if (!this.protector.isAvailable()) throw new Error('CPA_IMAGE_SECURE_STORAGE_UNAVAILABLE');
    const baseUrl = validatedCpaImageBaseUrl(input.settings.baseUrl ?? CPA_IMAGE_DEFAULT_BASE_URL);
    const submittedKey = input.apiKey.trim();
    const apiKey = submittedKey ? validateApiSecret(submittedKey, 'CPA key') : this.record && this.decrypt(this.record);
    if (!apiKey) throw new Error('CPA_IMAGE_KEY_REQUIRED');
    const changed = Boolean(submittedKey) || this.record?.baseUrl !== baseUrl;
    const now = new Date().toISOString();
    const next: Record = {
      schemaVersion: 1,
      encryptedApiKey: submittedKey ? this.protector.protect(apiKey).toString('base64') : this.record!.encryptedApiKey,
      apiKeyHint: secretHint(apiKey),
      baseUrl,
      state: changed ? 'UNVERIFIED' : (this.record?.state ?? 'UNVERIFIED'),
      message: changed ? 'CPA_IMAGE_SAVED_UNVERIFIED' : (this.record?.message ?? 'CPA_IMAGE_SAVED_UNVERIFIED'),
      updatedAt: now,
      lastVerifiedAt: changed ? null : (this.record?.lastVerifiedAt ?? null),
    };
    this.revision += 1;
    await this.write(next);
    this.record = next;
    this.loadError = null;
    return this.status();
  }

  async verify() {
    const record = this.record;
    if (!record) return this.status();
    const revision = ++this.revision;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let next: Record;
    try {
      const response = await this.fetchImpl(`${record.baseUrl}/models`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.decrypt(record)}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403 ? 'CPA_IMAGE_AUTH_FAILED' : 'CPA_IMAGE_CONNECTION_FAILED',
        );
      const models = await decodeProviderResponseJson(response, modelsSchema, {
        provider: 'CPA',
        maxBytes: 1024 * 1024,
      });
      const available = new Set(models.data.map((model) => model.id));
      const imageAvailable = available.has('gpt-image-2.5-flare') || available.has('gpt-image-2.5-sunburst');
      const now = new Date().toISOString();
      next = {
        ...record,
        state: imageAvailable ? 'READY' : 'UNVERIFIED',
        message: imageAvailable ? 'CPA_IMAGE_CONNECTED' : 'CPA_IMAGE_MODELS_UNCONFIRMED',
        updatedAt: now,
        lastVerifiedAt: imageAvailable ? now : record.lastVerifiedAt,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'CPA_IMAGE_CONNECTION_TIMEOUT'
          : error instanceof Error && error.message === 'CPA_IMAGE_AUTH_FAILED'
            ? error.message
            : 'CPA_IMAGE_CONNECTION_FAILED';
      next = {
        ...record,
        state: message === 'CPA_IMAGE_AUTH_FAILED' ? 'ERROR' : record.state,
        message,
        updatedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
    if (revision !== this.revision) return this.status();
    await this.write(next);
    this.record = next;
    return this.status();
  }

  async remove() {
    this.revision += 1;
    await rm(this.filePath, { force: true });
    this.record = null;
    this.loadError = null;
    return this.status();
  }

  async markVerified() {
    if (!this.record || this.record.state === 'READY') return;
    const now = new Date().toISOString();
    const next: Record = {
      ...this.record,
      state: 'READY',
      message: 'CPA_IMAGE_CONNECTED',
      updatedAt: now,
      lastVerifiedAt: now,
    };
    this.revision += 1;
    await this.write(next);
    this.record = next;
  }

  async markAuthError() {
    if (!this.record) return;
    const next: Record = {
      ...this.record,
      state: 'ERROR',
      message: 'CPA_IMAGE_AUTH_FAILED',
      updatedAt: new Date().toISOString(),
    };
    this.revision += 1;
    await this.write(next);
    this.record = next;
  }

  private decrypt(record: Record) {
    if (!this.protector.isAvailable()) throw new Error('CPA_IMAGE_SECURE_STORAGE_UNAVAILABLE');
    return validateApiSecret(this.protector.unprotect(Buffer.from(record.encryptedApiKey, 'base64')), 'CPA key');
  }

  private async write(record: Record) {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
