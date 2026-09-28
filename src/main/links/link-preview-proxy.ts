import { net, session, type Session } from 'electron';
import type { LinkResourceResult } from '@/main/links/link-preview-fetch';

export const LINK_PREVIEW_CONCURRENCY = 4;
let resolver: Promise<Session> | undefined;
const clients: { session: Session; rules: string; busy: boolean }[] = [];

function systemSession() {
  resolver ??= (async () => {
    const client = session.fromPartition('aiy-link-preview-system', { cache: false });
    await client.setProxy({ mode: 'system' });
    return client;
  })().catch((error: unknown) => {
    resolver = undefined;
    throw error;
  });
  return resolver;
}

/** PAC resolution has no cancellation API; stop waiting without retaining an abort listener. */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function resolveLinkProxy(url: URL, signal: AbortSignal): Promise<string | null> {
  try {
    const client = await untilAborted(systemSession(), signal);
    const configuration = await untilAborted(client.resolveProxy(url.href), signal);
    signal.throwIfAborted();
    const routes = configuration
      .split(';')
      .map((route) => route.trim())
      .filter(Boolean);
    if (routes[0] === 'DIRECT') return null;
    const proxies: string[] = [];
    for (const route of routes) {
      // A proxy failure must never turn into an unvalidated Chromium direct connection.
      if (route === 'DIRECT') break;
      const match = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[\da-f:]+\]|[\w.-]+):(\d{1,5})$/iu.exec(route);
      if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) throw new Error('LINK_PREVIEW_PROXY_UNAVAILABLE');
      const scheme = { PROXY: 'http', HTTPS: 'https', SOCKS: 'socks4', SOCKS4: 'socks4', SOCKS5: 'socks5' }[
        match[1].toUpperCase()
      ];
      proxies.push(`${scheme}://${match[2]}:${match[3]}`);
    }
    if (!proxies.length) throw new Error('LINK_PREVIEW_PROXY_UNAVAILABLE');
    return proxies.join(',');
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('LINK_PREVIEW_PROXY_UNAVAILABLE', { cause: error });
  }
}

function acquireClient() {
  let client = clients.find((candidate) => !candidate.busy);
  if (!client) {
    if (clients.length >= LINK_PREVIEW_CONCURRENCY) throw new Error('LINK_PREVIEW_BUSY');
    client = {
      session: session.fromPartition(`aiy-link-preview-proxy-${clients.length}`, { cache: false }),
      rules: '',
      busy: false,
    };
    clients.push(client);
  }
  client.busy = true;
  return client;
}

function headerValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : (value?.[0] ?? '');
}

async function requestResource(
  client: Session,
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
  accept: string,
  prefixOnly: boolean,
): Promise<LinkResourceResult> {
  const request = net.request({
    url: url.href,
    session: client,
    method: 'GET',
    credentials: 'omit',
    redirect: 'manual',
    cache: 'no-store',
    headers: { accept, 'accept-encoding': 'identity', 'user-agent': 'AIY-LinkPreview/1.0' },
  });
  let removeAbortListener: (() => void) | undefined;
  try {
    return await new Promise<LinkResourceResult>((resolve, reject) => {
      const abort = () => {
        reject(signal.reason);
        request.abort();
      };
      request.on('error', reject);
      // ClientRequest's writable side can close before the response arrives.
      // Cancellation belongs to the full exchange, not that writable close event.
      request.on('abort', () =>
        reject(signal.aborted ? signal.reason : new Error('LINK_PREVIEW_RESPONSE_INTERRUPTED')),
      );
      request.on('login', (_info, callback) => {
        reject(new Error('LINK_PREVIEW_PROXY_UNAVAILABLE'));
        callback();
      });
      // net.fetch rejects manual redirects without exposing Location. The request event
      // lets the caller validate the next URL and resolve its proxy before reconnecting.
      request.on('redirect', (_status, _method, location) => {
        resolve({ location });
        request.abort();
      });
      request.on('response', (response) => {
        response.on('error', reject);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error('LINK_PREVIEW_RESPONSE_UNAVAILABLE'));
          request.abort();
          return;
        }
        if (!prefixOnly && Number(headerValue(response.headers['content-length'])) > maxBytes) {
          reject(new Error('LINK_PREVIEW_RESPONSE_TOO_LARGE'));
          request.abort();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolve({
            url: url.href,
            contentType: headerValue(response.headers['content-type']),
            bytes: Buffer.concat(chunks, size),
          });
        response.on('data', (chunk: Buffer) => {
          if (!prefixOnly && size + chunk.length > maxBytes) {
            reject(new Error('LINK_PREVIEW_RESPONSE_TOO_LARGE'));
            request.abort();
            return;
          }
          const bytes = chunk.subarray(0, maxBytes - size);
          chunks.push(bytes);
          size += bytes.length;
          if (prefixOnly && size === maxBytes) {
            finish();
            request.abort();
          }
        });
        response.on('end', finish);
      });
      signal.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
      else request.end();
    });
  } finally {
    removeAbortListener?.();
    request.abort();
  }
}

/** Each active request owns a memory-only session until its body is closed. */
export async function fetchThroughProxy(
  url: URL,
  rules: string,
  signal: AbortSignal,
  maxBytes: number,
  accept: string,
  prefixOnly: boolean,
): Promise<LinkResourceResult> {
  const client = acquireClient();
  try {
    if (client.rules !== rules) {
      try {
        await client.session.closeAllConnections();
        await client.session.setProxy({ mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: '<-loopback>' });
      } catch (error) {
        throw new Error('LINK_PREVIEW_PROXY_UNAVAILABLE', { cause: error });
      }
      client.rules = rules;
    }
    signal.throwIfAborted();
    return await requestResource(client.session, url, signal, maxBytes, accept, prefixOnly).catch((error: unknown) => {
      signal.throwIfAborted();
      if (error instanceof Error && /ERR_(?:PROXY|SOCKS|TUNNEL|NO_SUPPORTED_PROXIES)/u.test(error.message))
        throw new Error('LINK_PREVIEW_PROXY_UNAVAILABLE', { cause: error });
      throw error;
    });
  } finally {
    client.busy = false;
  }
}
