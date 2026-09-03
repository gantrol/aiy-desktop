import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BROWSER_COMPANION_EXTENSION_ORIGIN,
  BROWSER_COMPANION_LOOPBACK_PORT,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionBridgeCredentialsSchema,
  browserCompanionTargetFromWebOrigin,
  type BrowserCompanionBridgeCredentials,
} from '@/main/browser-companion/protocol';
import { browserCompanionTargetSchema, type BrowserCompanionTarget } from '@/shared/contracts/browser-companion';

const CREDENTIALS_FILE_NAME = 'loopback-credentials.json';
const MAX_CREDENTIALS_BYTES = 4 * 1024;

function hasErrorCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

function credentialsPath(dataPath: string): string {
  return path.join(dataPath, CREDENTIALS_FILE_NAME);
}

export async function readBrowserCompanionCredentials(
  dataPath: string,
): Promise<BrowserCompanionBridgeCredentials | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(credentialsPath(dataPath), 'r');
  } catch (reason) {
    if (hasErrorCode(reason, 'ENOENT')) return null;
    throw reason;
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_CREDENTIALS_BYTES) return null;
    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) return null;
      offset += result.bytesRead;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return null;
    }
    return browserCompanionBridgeCredentialsSchema.safeParse(parsed).data ?? null;
  } finally {
    await handle.close();
  }
}

export async function loadOrCreateBrowserCompanionCredentials(
  dataPath: string,
): Promise<BrowserCompanionBridgeCredentials> {
  const existing = await readBrowserCompanionCredentials(dataPath);
  if (existing) return existing;

  const credentials = browserCompanionBridgeCredentialsSchema.parse({
    schemaVersion: 1,
    token: randomBytes(32).toString('base64url'),
  });
  await mkdir(dataPath, { recursive: true });
  const destination = credentialsPath(dataPath);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
  try {
    await rename(temporary, destination);
  } catch (reason) {
    if (!hasErrorCode(reason, 'EEXIST') && !hasErrorCode(reason, 'EPERM')) throw reason;
    await writeFile(destination, JSON.stringify(credentials), { flag: 'w', mode: 0o600 });
    await rm(temporary, { force: true });
  }
  return credentials;
}

export function createBrowserCompanionBridgeParameters(
  credentials: BrowserCompanionBridgeCredentials,
  rawTarget: BrowserCompanionTarget,
  rawDestinationUrl: string,
) {
  const target = browserCompanionTargetSchema.parse(rawTarget);
  const destination = new URL(rawDestinationUrl);
  if (browserCompanionTargetFromWebOrigin(destination.origin) !== target) {
    throw new Error('Browser companion destination does not match its target');
  }

  return {
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    port: BROWSER_COMPANION_LOOPBACK_PORT,
    token: credentials.token,
    target,
    destination: destination.toString(),
  } as const;
}

export function createBrowserCompanionBridgeUrl(
  credentials: BrowserCompanionBridgeCredentials,
  rawTarget: BrowserCompanionTarget,
  rawDestinationUrl: string,
): string {
  const parameters = createBrowserCompanionBridgeParameters(credentials, rawTarget, rawDestinationUrl);
  const fragment = new URLSearchParams({
    protocolVersion: String(parameters.protocolVersion),
    port: String(parameters.port),
    token: parameters.token,
    target: parameters.target,
    destination: parameters.destination,
  });
  return `${BROWSER_COMPANION_EXTENSION_ORIGIN}bridge.html#${fragment.toString()}`;
}
