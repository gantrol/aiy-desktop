/**
 * Outbound circuit breaker for every Vitest lane.
 *
 * Rule: a test run costs nothing. No lane, no configuration, and no accidental
 * default may reach a paid provider. Anything that is not loopback throws at the
 * call site, so the offending test names itself instead of quietly billing.
 *
 * Local stubs (`tests/support/openai-stub-server.ts`) bind to 127.0.0.1 on an
 * ephemeral port and pass through untouched.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const installed = Symbol.for('aiy.network-guard.installed');

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0', '']);

/**
 * Credentials that would make a real provider call succeed. Deleted so a
 * developer machine with a populated shell environment behaves like CI.
 */
const paidCredentialEnvKeys = [
  'OPENAI_API_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'ANTHROPIC_API_KEY',
];

export class BlockedOutboundRequestError extends Error {
  constructor(
    readonly target: string,
    readonly via: string,
  ) {
    super(
      `[network-guard] blocked outbound ${via} request to ${target}. ` +
        'Tests must use the local stub server (tests/support/openai-stub-server.ts) ' +
        'or an injected fake. Real provider traffic is never allowed in a test lane.',
    );
    this.name = 'BlockedOutboundRequestError';
  }
}

function isLoopbackHost(host: string | null | undefined) {
  if (host === null || host === undefined) return true;
  const bare = host.replace(/^\[|\]$/g, '').split('%')[0];
  return loopbackHosts.has(bare) || bare.endsWith('.localhost');
}

function assertLoopback(target: string, via: string, host: string | null | undefined) {
  if (!isLoopbackHost(host)) throw new BlockedOutboundRequestError(target, via);
}

function hostFromUrlish(value: unknown): { host: string | null; display: string } | null {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      return { host: url.hostname, display: url.origin };
    } catch {
      return null;
    }
  }
  if (value instanceof URL) return { host: value.hostname, display: value.origin };
  if (value && typeof value === 'object' && 'url' in value && typeof (value as { url: unknown }).url === 'string') {
    return hostFromUrlish((value as { url: string }).url);
  }
  return null;
}

/**
 * Rejects rather than throwing synchronously: callers write `await fetch(...)`
 * inside a try block and expect a rejected promise. A synchronous throw here
 * would escape `.catch()` chains and misattribute the failure.
 */
function guardFetch() {
  const realFetch = globalThis.fetch;
  if (typeof realFetch !== 'function') return;
  const guarded: typeof fetch = (input, init) => {
    const parsed = hostFromUrlish(input);
    if (parsed && !isLoopbackHost(parsed.host)) {
      return Promise.reject(new BlockedOutboundRequestError(parsed.display, 'fetch'));
    }
    return realFetch(input as Parameters<typeof fetch>[0], init);
  };
  globalThis.fetch = guarded;
}

type RequestFn = typeof http.request;

function guardNodeHttp(module: typeof http | typeof https, protocol: string) {
  for (const method of ['request', 'get'] as const) {
    const real = module[method] as RequestFn;
    const guarded = function guardedRequest(this: unknown, ...args: unknown[]) {
      const [first, second] = args;
      const parsed = hostFromUrlish(first);
      if (parsed) {
        assertLoopback(parsed.display, protocol, parsed.host);
      } else if (first && typeof first === 'object') {
        const options = first as { host?: string; hostname?: string; socketPath?: string };
        if (!options.socketPath) {
          const host = options.hostname ?? options.host;
          assertLoopback(`${protocol}//${host ?? 'unknown'}`, protocol, host);
        }
      }
      if (second && typeof second === 'object' && !(second instanceof Function)) {
        const options = second as { host?: string; hostname?: string; socketPath?: string };
        if (!options.socketPath && (options.hostname ?? options.host)) {
          const host = options.hostname ?? options.host;
          assertLoopback(`${protocol}//${host}`, protocol, host);
        }
      }
      return (real as (...callArgs: unknown[]) => unknown).apply(this, args);
    };
    (module as unknown as Record<string, unknown>)[method] = guarded;
  }
}

/**
 * The deepest escape hatch. Unix sockets, named pipes, and file descriptors are
 * left alone because the runner itself uses them.
 */
function guardSocketConnect() {
  const realNetConnect = net.connect;
  net.connect = function guardedConnect(this: unknown, ...args: unknown[]) {
    const [first] = args;
    if (first && typeof first === 'object' && !('path' in (first as object)) && !('fd' in (first as object))) {
      const options = first as { host?: string };
      assertLoopback(`tcp://${options.host ?? 'unknown'}`, 'net.connect', options.host);
    }
    return (realNetConnect as (...callArgs: unknown[]) => unknown).apply(this, args);
  } as typeof net.connect;

  const realTlsConnect = tls.connect;
  tls.connect = function guardedTlsConnect(this: unknown, ...args: unknown[]) {
    const [first] = args;
    if (first && typeof first === 'object' && !('path' in (first as object))) {
      const options = first as { host?: string };
      assertLoopback(`tls://${options.host ?? 'unknown'}`, 'tls.connect', options.host);
    }
    return (realTlsConnect as (...callArgs: unknown[]) => unknown).apply(this, args);
  } as typeof tls.connect;
}

export function installNetworkGuard() {
  const registry = globalThis as unknown as Record<symbol, boolean>;
  if (registry[installed]) return;
  registry[installed] = true;

  for (const key of paidCredentialEnvKeys) delete process.env[key];

  guardFetch();
  guardNodeHttp(http, 'http:');
  guardNodeHttp(https, 'https:');
  guardSocketConnect();
}

installNetworkGuard();
