import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 600_000;
const MAX_DRAFTS = 20;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
const envelope = (data) => ({ data, meta: { version: '1', updatedAt: new Date().toISOString() } });
function fail(response, status, code) {
  json(response, status, { error: { code, message: code } });
}
function authenticated(request, expected) {
  const actual = hash(String(request.headers.authorization ?? ''));
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function validDraft(value) {
  return (
    record(value) &&
    value.protocolVersion === 1 &&
    value.mode === 'draft' &&
    record(value.source) &&
    ['spaceId', 'articleId', 'revisionId', 'contentHash'].every(
      (key) => typeof value.source[key] === 'string' && value.source[key].length > 0 && value.source[key].length <= 200,
    ) &&
    /^[a-f0-9]{64}$/u.test(value.source.contentHash) &&
    record(value.target) &&
    typeof value.target.slug === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(value.target.slug) &&
    typeof value.title === 'string' &&
    value.title.length <= 120 &&
    typeof value.markdown === 'string' &&
    Buffer.byteLength(value.markdown) <= 512_000 &&
    Array.isArray(value.media) &&
    value.media.length === 0 &&
    value.coverAssetId === null
  );
}

/** Explicitly started developer tool; not package code loaded by AIY. All drafts are temporary in-memory data. */
export function createLocalDraftReceiver({ token = randomBytes(32).toString('hex') } = {}) {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) throw new Error('Use a random 32–128 character token');
  const expectedAuthorization = hash(`Bearer ${token}`);
  const drafts = new Map();
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
      // No CORS. Even the status endpoint requires the explicit temporary token.
      if (request.headers.origin) return fail(response, 403, 'BROWSER_REQUEST_DENIED');
      if (!authenticated(request, expectedAuthorization)) return fail(response, 401, 'TOKEN_REQUIRED');
      if (request.method === 'GET' && url.pathname === '/api/integrations/aiy/status') {
        return json(
          response,
          200,
          envelope({
            protocol: 'aiy-article-import',
            version: 1,
            capabilities: { documentModes: ['draft'] },
          }),
        );
      }
      if (url.pathname === '/api/integrations/aiy/media') return fail(response, 415, 'TEXT_ONLY_EXAMPLE');
      if (request.method !== 'POST' || url.pathname !== '/api/integrations/aiy/documents')
        return fail(response, 404, 'NOT_FOUND');
      if (request.headers['content-type']?.split(';')[0] !== 'application/json')
        return fail(response, 415, 'JSON_REQUIRED');
      if (Number(request.headers['content-length'] ?? 0) > MAX_BYTES) return fail(response, 413, 'BODY_TOO_LARGE');
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > MAX_BYTES) return fail(response, 413, 'BODY_TOO_LARGE');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        return fail(response, 400, 'INVALID_JSON');
      }
      if (!validDraft(value)) return fail(response, 400, 'INVALID_TEXT_DRAFT');
      const key = hash('aiy-article-import-v1\0' + body);
      if (request.headers['idempotency-key'] !== key) return fail(response, 400, 'INVALID_IDEMPOTENCY_KEY');
      const existing = drafts.get(key);
      if (existing) return json(response, 200, envelope({ ...existing.receipt, unchanged: true, replayed: true }));
      if (drafts.size >= MAX_DRAFTS) return fail(response, 507, 'EXAMPLE_CAPACITY_REACHED');
      const receipt = {
        mode: 'draft',
        documentId: key,
        revisionId: hash(body),
        version: 1,
        canonicalPath: `/drafts/${value.target.slug}`,
        // These are local receipt identifiers, not a hosted publication URL.
        adminUrl: `${origin}/drafts/${value.target.slug}`,
        publicUrl: `${origin}/drafts/${value.target.slug}`,
        unchanged: false,
        replayed: false,
      };
      drafts.set(key, { receipt, draft: value });
      json(response, 200, envelope(receipt));
    } catch {
      if (!response.headersSent) fail(response, 400, 'REQUEST_FAILED');
      else response.destroy();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 8;
  return {
    server,
    token,
    get size() {
      return drafts.size;
    },
    async listen(port = 47839) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      origin = `http://127.0.0.1:${server.address().port}`;
      return origin;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      drafts.clear();
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receiver = createLocalDraftReceiver();
  await receiver.listen();
  console.log('Local text-draft example at http://127.0.0.1:47839. Memory only; no publication.');
  console.log(`Temporary token (do not share): ${receiver.token}`);
  const close = () => {
    void receiver.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
