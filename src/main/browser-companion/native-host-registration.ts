import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  BROWSER_COMPANION_EXTENSION_ORIGIN,
  BROWSER_COMPANION_NATIVE_HOST_NAME,
} from '@/main/browser-companion/protocol';
import type { BrowserCompanionBrowserId } from '@/shared/contracts/browser-companion';

const nativeHostManifestSchema = z
  .object({
    name: z.literal(BROWSER_COMPANION_NATIVE_HOST_NAME),
    description: z.string().min(1).max(200),
    path: z.string().min(1).max(32_000),
    type: z.literal('stdio'),
    allowed_origins: z.tuple([z.literal(BROWSER_COMPANION_EXTENSION_ORIGIN)]),
  })
  .strict();

function hasErrorCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

async function executableFile(candidate: string | undefined): Promise<string | null> {
  const value = candidate?.trim();
  if (!value) return null;
  const resolved = path.resolve(value);
  try {
    const metadata = await stat(resolved);
    return metadata.isFile() && path.extname(resolved).toLocaleLowerCase() === '.exe' ? resolved : null;
  } catch {
    return null;
  }
}

async function readSmallFile(filePath: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, 'r');
  } catch (reason) {
    if (hasErrorCode(reason, 'ENOENT')) return null;
    throw reason;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 16 * 1024) return null;
    const bytes = Buffer.alloc(metadata.size);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    return result.bytesRead === bytes.length ? bytes : null;
  } finally {
    await handle.close();
  }
}

function runRegistryAdd(registryExecutable: string, manifestPath: string, productKey: string): Promise<void> {
  const key = `HKCU\\Software\\${productKey}\\NativeMessagingHosts\\${BROWSER_COMPANION_NATIVE_HOST_NAME}`;
  return new Promise((resolve, reject) => {
    execFile(
      registryExecutable,
      ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
      { windowsHide: true },
      (reason) => {
        if (reason) reject(reason);
        else resolve();
      },
    );
  });
}

export class BrowserCompanionNativeHostRegistration {
  constructor(
    private readonly options: {
      appPath: string;
      dataPath: string;
      environment: NodeJS.ProcessEnv;
      platform: NodeJS.Platform;
      resourcesPath: string;
    },
  ) {}

  private async resolveExecutable(): Promise<string | null> {
    const candidates = [
      this.options.environment.AIY_BROWSER_COMPANION_HOST_EXECUTABLE,
      path.join(this.options.resourcesPath, 'browser-companion', 'aiy-browser-companion-host.exe'),
      path.join(this.options.appPath, '.tmp', 'browser-companion-host', 'aiy-browser-companion-host.exe'),
    ];
    for (const candidate of candidates) {
      const executable = await executableFile(candidate);
      if (executable) return executable;
    }
    return null;
  }

  async register(browserId: BrowserCompanionBrowserId): Promise<void> {
    if (this.options.platform !== 'win32') throw new Error('Browser Native Messaging is unavailable on this platform');
    const executable = await this.resolveExecutable();
    if (!executable) throw new Error('AIY browser companion Native Host executable is unavailable');

    const directory = path.join(this.options.dataPath, 'native-messaging');
    const manifestPath = path.join(directory, `${BROWSER_COMPANION_NATIVE_HOST_NAME}.json`);
    const manifest = nativeHostManifestSchema.parse({
      name: BROWSER_COMPANION_NATIVE_HOST_NAME,
      description: 'AIY browser companion local handoff host',
      path: executable,
      type: 'stdio',
      allowed_origins: [BROWSER_COMPANION_EXTENSION_ORIGIN],
    });
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    await mkdir(directory, { recursive: true });
    const existing = await readSmallFile(manifestPath);
    if (!existing?.equals(bytes)) {
      const temporaryPath = path.join(directory, `.${BROWSER_COMPANION_NATIVE_HOST_NAME}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
      try {
        await rename(temporaryPath, manifestPath);
      } catch (reason) {
        if (!hasErrorCode(reason, 'EEXIST') && !hasErrorCode(reason, 'EPERM')) throw reason;
        await writeFile(manifestPath, bytes, { flag: 'w', mode: 0o600 });
        await rm(temporaryPath, { force: true });
      }
    }

    const systemRoot = this.options.environment.SystemRoot?.trim();
    const registryExecutable = systemRoot ? path.join(systemRoot, 'System32', 'reg.exe') : 'reg.exe';
    const productKey = browserId === 'edge' ? 'Microsoft\\Edge' : 'Google\\Chrome';
    await runRegistryAdd(registryExecutable, manifestPath, productKey);
    if (this.options.environment.AIY_BROWSER_COMPANION_ENABLE_CHROMIUM === '1') {
      await runRegistryAdd(registryExecutable, manifestPath, 'Chromium');
    }
  }
}
