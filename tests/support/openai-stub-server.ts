/**
 * L2 protocol stub: a real HTTP server on 127.0.0.1 that speaks the OpenAI
 * Images wire format.
 *
 * This exists because `vi.mock()` proves nothing about serialization. Driving a
 * real socket verifies multipart field order, header propagation, SSE framing,
 * and timeout behaviour — the parts that actually break — while every byte stays
 * on loopback and every run costs nothing.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openAiFixture, readFixture, readFixtureJson } from './fixtures';

export type StubBehavior =
  /** Inline JSON body. */
  | { kind: 'json'; status?: number; body: unknown; headers?: Record<string, string> }
  /** JSON body loaded from `tests/fixtures/openai-image/<fixture>`. */
  | { kind: 'fixture'; status?: number; fixture: string; headers?: Record<string, string> }
  /** Replays an `.sse` fixture as `text/event-stream`. */
  | { kind: 'sse'; fixture: string; headers?: Record<string, string>; eventDelayMs?: number }
  /** Streams `afterEvents` SSE events, then destroys the socket mid-stream. */
  | { kind: 'abort-mid-sse'; fixture: string; afterEvents: number }
  /** Flushes response headers, then destroys the socket before any body. */
  | { kind: 'abort-after-headers'; status?: number }
  /** Accepts the request and never answers. Drives client-side timeout tests. */
  | { kind: 'never-respond' }
  /** Arbitrary bytes — malformed JSON, truncated payloads, wrong content types. */
  | { kind: 'raw'; status: number; body: string | Buffer; headers?: Record<string, string> };

export type StubRoute = 'generations' | 'edits' | 'models';

/**
 * One behavior applies to every call. An array is consumed per call, and the
 * final entry repeats — so `[rateLimited, ok]` models "fails once, then succeeds"
 * without counting retries by hand.
 */
export type StubScript = Partial<Record<StubRoute, StubBehavior | StubBehavior[]>>;

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  size: number;
}

export interface RecordedRequest {
  route: StubRoute | 'unknown';
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json<T = unknown>(): T;
  /** Multipart part names in wire order. Reference-image ordering is a contract. */
  multipart(): MultipartPart[];
}

export interface OpenAiStubServer {
  /** Pass to the adapter as its injected base URL. Always loopback. */
  url: string;
  port: number;
  requests: RecordedRequest[];
  requestsFor(route: StubRoute): RecordedRequest[];
  close(): Promise<void>;
}

const defaultScript: StubScript = {
  generations: { kind: 'fixture', fixture: 'generation-success.json' },
  edits: { kind: 'fixture', fixture: 'edit-success.json' },
  models: { kind: 'fixture', fixture: 'models-success.json' },
};

function routeFor(url: string): StubRoute | 'unknown' {
  if (url.startsWith('/v1/images/generations')) return 'generations';
  if (url.startsWith('/v1/images/edits')) return 'edits';
  if (url.startsWith('/v1/models')) return 'models';
  return 'unknown';
}

function parseMultipart(body: Buffer, contentType: string | undefined): MultipartPart[] {
  const boundary = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return [];
  const parts: MultipartPart[] = [];
  const segments = body.toString('latin1').split(`--${marker}`);
  for (const segment of segments) {
    const separator = segment.indexOf('\r\n\r\n');
    if (separator < 0) continue;
    const rawHeaders = segment.slice(0, separator);
    const name = rawHeaders.match(/name="([^"]*)"/i)?.[1];
    if (!name) continue;
    parts.push({
      name,
      ...(rawHeaders.match(/filename="([^"]*)"/i)?.[1] !== undefined
        ? { filename: rawHeaders.match(/filename="([^"]*)"/i)![1] }
        : {}),
      ...(rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]
        ? { contentType: rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i)![1].trim() }
        : {}),
      size: Math.max(segment.length - separator - 8, 0),
    });
  }
  return parts;
}

function splitSseEvents(source: string) {
  return source.split(/\r?\n\r?\n/).filter((chunk) => chunk.trim().length > 0);
}

function nextBehavior(script: StubScript, route: StubRoute | 'unknown', callIndex: number): StubBehavior {
  if (route === 'unknown') return { kind: 'raw', status: 404, body: 'unknown route' };
  const entry = script[route] ?? defaultScript[route];
  if (!entry) return { kind: 'raw', status: 404, body: 'route not scripted' };
  if (!Array.isArray(entry)) return entry;
  if (entry.length === 0) return { kind: 'raw', status: 500, body: 'empty behavior list' };
  return entry[Math.min(callIndex, entry.length - 1)];
}

async function respond(behavior: StubBehavior, response: http.ServerResponse) {
  switch (behavior.kind) {
    case 'never-respond':
      return;

    case 'abort-after-headers': {
      response.writeHead(behavior.status ?? 200, { 'Content-Type': 'application/json' });
      response.flushHeaders();
      response.socket?.destroy();
      return;
    }

    case 'raw': {
      response.writeHead(behavior.status, {
        'Content-Type': 'text/plain',
        ...behavior.headers,
      });
      response.end(behavior.body);
      return;
    }

    case 'json':
    case 'fixture': {
      const body = behavior.kind === 'json' ? behavior.body : readFixtureJson(openAiFixture(behavior.fixture));
      response.writeHead(behavior.status ?? 200, {
        'Content-Type': 'application/json',
        'x-request-id': 'req_stub_00000000',
        ...behavior.headers,
      });
      response.end(JSON.stringify(body));
      return;
    }

    case 'sse':
    case 'abort-mid-sse': {
      const events = splitSseEvents(readFixture(openAiFixture(behavior.fixture)).toString('utf8'));
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'x-request-id': 'req_stub_00000000',
        ...(behavior.kind === 'sse' ? behavior.headers : {}),
      });
      const limit = behavior.kind === 'abort-mid-sse' ? behavior.afterEvents : events.length;
      const delay = behavior.kind === 'sse' ? (behavior.eventDelayMs ?? 0) : 0;
      for (const event of events.slice(0, limit)) {
        response.write(`${event}\n\n`);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (behavior.kind === 'abort-mid-sse') response.socket?.destroy();
      else response.end();
    }
  }
}

export async function startOpenAiStub(script: StubScript = {}): Promise<OpenAiStubServer> {
  const requests: RecordedRequest[] = [];
  const callCounts = new Map<string, number>();

  const server = http.createServer((request, response) => {
    const route = routeFor(request.url ?? '');
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = request.headers['content-type'];
      requests.push({
        route,
        method: request.method ?? 'GET',
        url: request.url ?? '',
        headers: request.headers,
        body,
        json: <T>() => JSON.parse(body.toString('utf8')) as T,
        multipart: () => parseMultipart(body, contentType),
      });
      const callIndex = callCounts.get(route) ?? 0;
      callCounts.set(route, callIndex + 1);
      void respond(nextBehavior(script, route, callIndex), response);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    requests,
    requestsFor: (route) => requests.filter((entry) => entry.route === route),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
