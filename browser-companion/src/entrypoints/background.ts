import { companionMessage } from '@/lib/i18n';
import { openWechatSocialPost, wechatNavigationRequestSchema } from '@/lib/composer-adapters/wechat-navigation';
import {
  BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX,
  BROWSER_COMPANION_CONNECTION_STORAGE_KEY,
  BROWSER_COMPANION_LOOPBACK_ORIGIN,
  BROWSER_COMPANION_MAX_RESPONSE_BYTES,
  BROWSER_COMPANION_MEDIA_PATH,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  BROWSER_COMPANION_REQUEST_PATH,
  browserCompanionBootstrapMessageSchema,
  browserCompanionBridgeMessageSchema,
  browserCompanionConnectionSchema,
  browserCompanionLoopbackEnvelopeSchema,
  browserCompanionResponseSchema,
  resolveSiteFromUrl,
  type BrowserCompanionConnection,
  type BrowserCompanionMedia,
  type CompanionSite,
} from '@/lib/protocol';

const encoder = new TextEncoder();

function tokenBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}=`;
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function connection(): Promise<BrowserCompanionConnection> {
  const stored = await browser.storage.local.get(BROWSER_COMPANION_CONNECTION_STORAGE_KEY);
  return browserCompanionConnectionSchema.parse(stored[BROWSER_COMPANION_CONNECTION_STORAGE_KEY]);
}

async function key(activeConnection: BrowserCompanionConnection): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', tokenBytes(activeConnection.token), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function sign(hmacKey: CryptoKey, value: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(value)));
}

async function verify(hmacKey: CryptoKey, value: string, signature: string): Promise<boolean> {
  return crypto.subtle.verify('HMAC', hmacKey, bytesFromHex(signature), encoder.encode(value));
}

function verificationPayload(requestId: string, site: CompanionSite): string {
  return `verify\n${requestId}\n${site}`;
}

function mediaSignaturePayload(requestId: string, media: BrowserCompanionMedia): string {
  return `media\n${requestId}\n${media.mediaId}\n${media.byteSize}\n${media.sha256}\n${media.mimeType}`;
}

function senderMatchesSite(sender: Browser.runtime.MessageSender, site: CompanionSite): boolean {
  return Boolean(sender.tab) && resolveSiteFromUrl(sender.url) === site && resolveSiteFromUrl(sender.tab?.url) === site;
}

function senderIsLoopbackBootstrap(sender: Browser.runtime.MessageSender): boolean {
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.origin === BROWSER_COMPANION_LOOPBACK_ORIGIN &&
      new RegExp(`^${BROWSER_COMPANION_BOOTSTRAP_PATH_PREFIX}[0-9a-f-]{36}$`, 'i').test(url.pathname)
    );
  } catch {
    return false;
  }
}

const rejected = {
  protocolVersion: 1,
  ok: false,
  kind: 'rejected-loopback-bridge',
} as const;

export default defineBackground(() => {
  void browser.action.setTitle({ title: companionMessage('extensionName') }).catch(() => undefined);

  browser.runtime.onMessage.addListener(async (rawMessage: unknown, sender) => {
    const navigation = wechatNavigationRequestSchema.safeParse(rawMessage);
    if (navigation.success) {
      if (sender.frameId !== 0 || sender.tab?.id === undefined || !senderMatchesSite(sender, 'wechat')) return false;
      return openWechatSocialPost(sender.tab.id, navigation.data.handoffId, navigation.data.contentKind).catch(
        () => false,
      );
    }
    const parsed = browserCompanionBridgeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) return { ...rejected, reason: 'INVALID_MESSAGE' };
    if (!senderMatchesSite(sender, parsed.data.site)) return { ...rejected, reason: 'UNTRUSTED_SENDER' };

    const configured = await connection().catch(() => null);
    if (!configured) return { ...rejected, reason: 'CONNECTION_NOT_CONFIGURED' };

    try {
      const activeKey = await key(configured);
      const message = parsed.data;
      if (message.kind === 'authorize-loopback-request') {
        const mediaRequest = message.request.kind === 'read-media';
        if (
          (mediaRequest && message.path !== BROWSER_COMPANION_MEDIA_PATH) ||
          (!mediaRequest && message.path !== BROWSER_COMPANION_REQUEST_PATH) ||
          ((message.request.kind === 'claim-handoff' || message.request.kind === 'claim-latest') &&
            message.request.target !== message.site)
        ) {
          return rejected;
        }
        const envelope = browserCompanionLoopbackEnvelopeSchema.parse({
          protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
          requestId: crypto.randomUUID(),
          sentAt: Date.now(),
          nonce: crypto.randomUUID(),
          target: message.site,
          request: message.request,
        });
        const body = JSON.stringify(envelope);
        return {
          protocolVersion: 1,
          ok: true,
          kind: 'authorized-loopback-request',
          requestId: envelope.requestId,
          body,
          signature: await sign(activeKey, body),
          verificationToken: await sign(activeKey, verificationPayload(envelope.requestId, message.site)),
        } as const;
      }

      if (!(await verify(activeKey, verificationPayload(message.requestId, message.site), message.verificationToken))) {
        return rejected;
      }
      if (message.kind === 'verify-loopback-json') {
        if (
          encoder.encode(message.body).byteLength > BROWSER_COMPANION_MAX_RESPONSE_BYTES ||
          !(await verify(activeKey, `${message.requestId}\n${message.body}`, message.signature))
        ) {
          return rejected;
        }
        return {
          protocolVersion: 1,
          ok: true,
          kind: 'verified-loopback-json',
          response: browserCompanionResponseSchema.parse(JSON.parse(message.body) as unknown),
        } as const;
      }
      if (!(await verify(activeKey, mediaSignaturePayload(message.requestId, message.media), message.signature))) {
        return rejected;
      }
      return {
        protocolVersion: 1,
        ok: true,
        kind: 'verified-loopback-media',
      } as const;
    } catch {
      return { ...rejected, reason: 'VERIFICATION_FAILED' };
    }
  });

  browser.runtime.onMessageExternal.addListener(async (rawMessage: unknown, sender) => {
    const parsed = browserCompanionBootstrapMessageSchema.safeParse(rawMessage);
    if (!parsed.success || !senderIsLoopbackBootstrap(sender)) {
      return {
        protocolVersion: 1,
        ok: false,
        kind: 'rejected-loopback-bootstrap',
      } as const;
    }
    try {
      await browser.storage.local.set({
        [BROWSER_COMPANION_CONNECTION_STORAGE_KEY]: parsed.data.connection,
      });
      return {
        protocolVersion: 1,
        ok: true,
        kind: 'connected-loopback',
      } as const;
    } catch {
      return {
        protocolVersion: 1,
        ok: false,
        kind: 'rejected-loopback-bootstrap',
      } as const;
    }
  });
});
