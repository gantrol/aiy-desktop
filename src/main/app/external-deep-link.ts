import { app } from 'electron';
import { z } from 'zod';
import { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import {
  AIY_DEEP_LINK_SCHEME,
  APP_DEEP_LINK_AVAILABLE_CHANNEL,
  MAX_PENDING_APP_DEEP_LINKS,
  appDeepLinkCommandListSchema,
  appDeepLinkCommandSchema,
  type AppDeepLinkCommand,
} from '@/shared/contracts/app-deep-link';

const rawDeepLinkSchema = z.string().trim().min(1).max(2_048);
const commandLineSchema = z.array(z.string().max(32_768)).max(256);

function unwrapCommandLineArgument(value: string) {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if (trimmed.length >= 2 && first === last && (first === '"' || first === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseAiyDeepLink(rawValue: unknown): AppDeepLinkCommand | null {
  const parsedValue = rawDeepLinkSchema.safeParse(rawValue);
  if (!parsedValue.success) return null;
  const value = unwrapCommandLineArgument(parsedValue.data);
  if (value.includes('?') || value.includes('#')) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== `${AIY_DEEP_LINK_SCHEME}:` ||
    url.hostname !== 'open' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }

  if (url.pathname === '/gallery') {
    return appDeepLinkCommandSchema.parse({ schemaVersion: 1, action: 'open', target: 'gallery' });
  }
  const route = /^\/space\/([A-Za-z0-9._:-]+)\/(article|material)\/([A-Za-z0-9._:-]+)$/.exec(url.pathname);
  if (!route) return null;
  const command = appDeepLinkCommandSchema.safeParse({
    schemaVersion: 1,
    action: 'open',
    target: route[2],
    spaceId: route[1],
    entityId: route[3],
  });
  return command.success ? command.data : null;
}

export class AppDeepLinkController {
  private readonly pending: AppDeepLinkCommand[] = [];

  constructor(private readonly rendererEvents: RendererEventDispatcher) {}

  acceptUrl(rawValue: unknown) {
    const command = parseAiyDeepLink(rawValue);
    if (!command) return false;
    if (this.pending.length === MAX_PENDING_APP_DEEP_LINKS) this.pending.shift();
    this.pending.push(command);
    this.rendererEvents.send(APP_DEEP_LINK_AVAILABLE_CHANNEL);
    return true;
  }

  acceptCommandLine(rawCommandLine: unknown) {
    const parsedCommandLine = commandLineSchema.safeParse(rawCommandLine);
    if (!parsedCommandLine.success) return;
    for (const argument of parsedCommandLine.data) {
      const candidate = unwrapCommandLineArgument(argument);
      if (!candidate.toLowerCase().startsWith(`${AIY_DEEP_LINK_SCHEME}:`)) continue;
      if (!this.acceptUrl(candidate)) console.warn('[deep-link] Rejected an invalid aiy URL');
    }
  }

  takePending() {
    const commands = appDeepLinkCommandListSchema.parse([...this.pending]);
    this.pending.length = 0;
    return commands;
  }
}

export function registerAiyDeepLinkProtocolClient() {
  if (!isPackagedApplication(app) || process.windowsStore) return;
  if (!app.setAsDefaultProtocolClient(AIY_DEEP_LINK_SCHEME)) {
    console.warn('[deep-link] Failed to register the aiy URL protocol');
  }
}
