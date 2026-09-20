import {
  BROWSER_COMPANION_CONNECTION_STORAGE_KEY,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionBridgeParametersSchema,
  browserCompanionConnectionSchema,
  resolveSiteFromUrl,
} from '@/lib/protocol';
import { registerHandoffTab } from '@/lib/batch-tabs';

function fragmentParameters(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
}

async function connect(): Promise<void> {
  const parsed = browserCompanionBridgeParametersSchema.parse(fragmentParameters());
  if (resolveSiteFromUrl(parsed.destination) !== parsed.target) {
    throw new Error('Browser companion destination does not match its target');
  }
  const connection = browserCompanionConnectionSchema.parse({
    schemaVersion: 1,
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    port: parsed.port,
    token: parsed.token,
  });
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  await browser.storage.local.set({
    [BROWSER_COMPANION_CONNECTION_STORAGE_KEY]: connection,
  });
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined && tab.windowId !== undefined) {
    await registerHandoffTab(tab.id, tab.windowId, parsed.destination).catch(() => undefined);
  }
  window.location.replace(parsed.destination);
}

void connect().catch(() => {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  window.location.replace('about:blank');
});
