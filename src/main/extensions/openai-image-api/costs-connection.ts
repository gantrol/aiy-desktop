import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SecretProtector } from '@/main/extensions/secure-credentials';
import {
  openAiCostsConnectionClearSchema,
  openAiCostsConnectionSaveSchema,
  openAiCostsConnectionStatusSchema,
  type OpenAiCostsConnectionClearInput,
  type OpenAiCostsConnectionSaveInput,
  type OpenAiCostsConnectionStatus,
} from '@/shared/openai-costs';

const MAX_RECORD_BYTES = 32 * 1024;
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    connectionId: z.string().uuid(),
    encryptedAdminKey: z.string().min(1).max(24_000),
    organizationId: openAiCostsConnectionStatusSchema.shape.organizationId,
    updatedAt: z.string().datetime(),
  })
  .strict();
type ConnectionRecord = z.infer<typeof recordSchema>;

/** Main-process credentials only; this type must never cross IPC. */
export interface OpenAiCostsCredentials {
  connectionId: string;
  adminKey: string;
  organizationId: string | null;
}

function emptyStatus(): OpenAiCostsConnectionStatus {
  return {
    configured: false,
    connectionId: null,
    organizationId: null,
    state: 'NOT_CONFIGURED',
    updatedAt: null,
    message: null,
  };
}
function statusFor(record: ConnectionRecord): OpenAiCostsConnectionStatus {
  return openAiCostsConnectionStatusSchema.parse({
    configured: true,
    connectionId: record.connectionId,
    organizationId: record.organizationId,
    state: 'CONFIGURED',
    updatedAt: record.updatedAt,
    message: 'OPENAI_COSTS_CONNECTION_UNVERIFIED',
  });
}

/** An independent app-global Admin connection. Saving never contacts OpenAI. */
export class OpenAiCostsConnection {
  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
  ) {}

  async status(): Promise<OpenAiCostsConnectionStatus> {
    try {
      const record = await this.read();
      if (!record) return emptyStatus();
      if (!this.protector.isAvailable()) throw new Error('OPENAI_COSTS_SECURE_STORAGE_UNAVAILABLE');
      return statusFor(record);
    } catch {
      return { ...emptyStatus(), configured: true, state: 'ERROR', message: 'OPENAI_COSTS_CONNECTION_UNAVAILABLE' };
    }
  }

  async credentials(): Promise<OpenAiCostsCredentials | null> {
    try {
      const record = await this.read();
      return record
        ? { connectionId: record.connectionId, adminKey: this.decrypt(record), organizationId: record.organizationId }
        : null;
    } catch {
      throw new Error('OPENAI_COSTS_CONNECTION_UNAVAILABLE');
    }
  }

  async save(raw: OpenAiCostsConnectionSaveInput): Promise<OpenAiCostsConnectionStatus> {
    const input = openAiCostsConnectionSaveSchema.parse(raw);
    if (!this.protector.isAvailable()) throw new Error('OPENAI_COSTS_SECURE_STORAGE_UNAVAILABLE');
    // A new key can replace an unreadable old file without decrypting that old secret.
    const current = input.adminKey ? null : await this.read();
    if (!input.adminKey && !current) throw new Error('OPENAI_COSTS_ADMIN_KEY_REQUIRED');
    const changed = Boolean(input.adminKey) || current?.organizationId !== input.organizationId;
    let encryptedAdminKey: string;
    try {
      encryptedAdminKey = input.adminKey
        ? this.protector.protect(input.adminKey).toString('base64')
        : current!.encryptedAdminKey;
    } catch {
      throw new Error('OPENAI_COSTS_SECURE_STORAGE_UNAVAILABLE');
    }
    const next = recordSchema.parse({
      schemaVersion: 1,
      connectionId: changed ? randomUUID() : current!.connectionId,
      encryptedAdminKey,
      organizationId: input.organizationId,
      updatedAt: new Date().toISOString(),
    });
    await this.write(next);
    return statusFor(next);
  }

  async clear(raw: OpenAiCostsConnectionClearInput = {}): Promise<OpenAiCostsConnectionStatus> {
    openAiCostsConnectionClearSchema.parse(raw);
    await rm(this.filePath, { force: true });
    return emptyStatus();
  }

  private decrypt(record: ConnectionRecord) {
    if (!this.protector.isAvailable()) throw new Error('OPENAI_COSTS_SECURE_STORAGE_UNAVAILABLE');
    try {
      const input = openAiCostsConnectionSaveSchema.parse({
        adminKey: this.protector.unprotect(Buffer.from(record.encryptedAdminKey, 'base64')),
      });
      if (!input.adminKey) throw new Error('Missing administrator key');
      return input.adminKey;
    } catch {
      throw new Error('OPENAI_COSTS_CONNECTION_UNAVAILABLE');
    }
  }

  private async read(): Promise<ConnectionRecord | null> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.filePath, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('OPENAI_COSTS_CONNECTION_UNAVAILABLE');
    }
    try {
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let size = 0;
      while (size <= MAX_RECORD_BYTES) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_RECORD_BYTES) throw new Error('Stored record is too large');
      return recordSchema.parse(JSON.parse(buffer.subarray(0, size).toString('utf8')));
    } catch {
      throw new Error('OPENAI_COSTS_CONNECTION_UNAVAILABLE');
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private async write(record: ConnectionRecord) {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new Error('OPENAI_COSTS_CONNECTION_SAVE_FAILED');
    }
  }
}
