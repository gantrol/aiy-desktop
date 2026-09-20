import { z } from 'zod';
import type { OpenAiCostsCredentials } from '@/main/extensions/openai-image-api/costs-connection';
import {
  openAiCostsConnectionSaveSchema,
  openAiCostsRangeSchema,
  type OpenAiCostsPage,
  type OpenAiCostsRange,
  type OpenAiCostsRefreshResult,
} from '@/shared/openai-costs';

const ENDPOINT = 'https://api.openai.com/v1/organization/costs';
const PAGE_BYTES = 4 * 1024 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 32;
const MAX_RESULTS = 20_000;
const DEADLINE_MS = 90_000;
class DecimalToken {
  constructor(readonly source: string) {}
}
function decimalText(source: string) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match || source.length > 128) throw new Error('Invalid decimal');
  const exponent = BigInt(match[4] ?? '0');
  if (exponent < -100n || exponent > 100n) throw new Error('Decimal exponent is too large');
  const digits = match[2]! + (match[3] ?? '');
  const position = match[2]!.length + Number(exponent);
  if (position > 100 || digits.length - position > 100) throw new Error('Decimal is too large');
  const expanded =
    position <= 0
      ? `0.${'0'.repeat(-position)}${digits}`
      : position >= digits.length
        ? digits + '0'.repeat(position - digits.length)
        : `${digits.slice(0, position)}.${digits.slice(position)}`;
  const normalized = match[1] + expanded.replace(/^0+(?=\d)/, '');
  if (normalized.length > 100) throw new Error('Decimal is too large');
  return normalized;
}
const decimal = z.instanceof(DecimalToken).transform((value) => decimalText(value.source));
const optionalText = z.string().max(2_000).nullish();
const resultSchema = z.object({
  object: z.literal('organization.costs.result'),
  amount: z.object({ value: decimal.nullish(), currency: z.string().max(20).nullish() }).nullish(),
  quantity: decimal.nullish(),
  quantity_unit: optionalText,
  project_id: optionalText,
  line_item: optionalText,
  api_key_id: optionalText,
});
const bucketSchema = z
  .object({
    object: z.literal('bucket'),
    start_time: z.number().int().nonnegative().safe(),
    end_time: z.number().int().positive().safe(),
    results: z.array(resultSchema).max(MAX_RESULTS),
  })
  .refine((bucket) => bucket.end_time > bucket.start_time);
const pageSchema = z.object({
  object: z.literal('page'),
  data: z.array(bucketSchema).max(180),
  has_more: z.boolean(),
  next_page: z.string().min(1).max(4_096).nullable(),
});

function parsePage(serialized: string): OpenAiCostsPage {
  try {
    // Supported Node/Electron runtimes expose the original numeric lexeme here.
    // A runtime without it fails closed instead of silently rounding money.
    const raw: unknown = JSON.parse(serialized, (key: string, value: unknown, context?: { source?: string }) => {
      if ((key === 'value' || key === 'quantity') && typeof value === 'number') {
        if (!context?.source) throw new Error('Original decimal unavailable');
        return new DecimalToken(context.source);
      }
      return value;
    });
    const parsed = pageSchema.parse(raw);
    if (parsed.has_more !== (parsed.next_page !== null)) throw new Error('Invalid page continuation');
    return {
      buckets: parsed.data.map((bucket) => ({
        startTime: bucket.start_time,
        endTime: bucket.end_time,
        results: bucket.results.map((result) => ({
          amount: result.amount
            ? { value: result.amount.value ?? null, currency: result.amount.currency ?? null }
            : null,
          quantity: result.quantity ?? null,
          quantityUnit: result.quantity_unit ?? null,
          projectId: result.project_id ?? null,
          lineItem: result.line_item ?? null,
          apiKeyId: result.api_key_id ?? null,
        })),
      })),
      hasMore: parsed.has_more,
      nextPage: parsed.next_page,
    };
  } catch {
    throw new Error('OPENAI_COSTS_RESPONSE_INVALID');
  }
}

async function boundedText(response: Response, signal: AbortSignal, maximum: number) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('OPENAI_COSTS_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('OPENAI_COSTS_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        void reader.cancel().catch(() => undefined);
        throw new Error('OPENAI_COSTS_RESPONSE_TOO_LARGE');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { text: text + decoder.decode(), bytes };
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Explicit refresh only. It does not read image credentials, scan logs or mutate a cache. */
export async function fetchOpenAiCosts(
  credentials: OpenAiCostsCredentials,
  rawRange: OpenAiCostsRange,
  callerSignal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  beforeRequest?: () => void,
): Promise<OpenAiCostsRefreshResult> {
  const range = openAiCostsRangeSchema.parse(rawRange);
  const connectionId = z.string().uuid().parse(credentials.connectionId);
  const secret = openAiCostsConnectionSaveSchema.parse({
    adminKey: credentials.adminKey,
    organizationId: credentials.organizationId,
  });
  if (!secret.adminKey) throw new Error('OPENAI_COSTS_ADMIN_KEY_REQUIRED');
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const signal = AbortSignal.any([callerSignal, deadline]);
  const pages: OpenAiCostsPage[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  let bytes = 0;
  let results = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      if (pages.length >= MAX_PAGES) throw new Error('OPENAI_COSTS_PAGE_LIMIT');
      const url = new URL(ENDPOINT);
      url.searchParams.set('start_time', String(range.startTime));
      url.searchParams.set('end_time', String(range.endTime));
      url.searchParams.set('bucket_width', '1d');
      url.searchParams.set('limit', '180');
      for (const field of ['project_id', 'line_item', 'api_key_id']) url.searchParams.append('group_by', field);
      if (cursor) url.searchParams.set('page', cursor);
      beforeRequest?.();
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${secret.adminKey}`,
          ...(secret.organizationId ? { 'OpenAI-Organization': secret.organizationId } : {}),
        },
        redirect: 'error',
        signal,
      });
      if (signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        signal.throwIfAborted();
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'OPENAI_COSTS_AUTH_FAILED'
            : `OPENAI_COSTS_HTTP_${response.status}`,
        );
      }
      const body = await boundedText(response, signal, Math.min(PAGE_BYTES, TOTAL_BYTES - bytes));
      bytes += body.bytes;
      const page = parsePage(body.text);
      results += page.buckets.reduce((sum, bucket) => sum + bucket.results.length, 0);
      if (results > MAX_RESULTS) throw new Error('OPENAI_COSTS_RESULT_LIMIT');
      // Daily bucket boundaries remain exactly as returned; no local-day redistribution.
      if (page.buckets.some((bucket) => bucket.endTime <= range.startTime || bucket.startTime >= range.endTime)) {
        throw new Error('OPENAI_COSTS_BUCKET_OUT_OF_RANGE');
      }
      pages.push(page);
      if (!page.hasMore) break;
      if (!page.nextPage || visited.has(page.nextPage)) throw new Error('OPENAI_COSTS_PAGE_LOOP');
      visited.add(page.nextPage);
      cursor = page.nextPage;
    }
    signal.throwIfAborted();
    return { ...range, connectionId, capturedAt: new Date().toISOString(), pages };
  } catch (error) {
    if (callerSignal.aborted) throw new DOMException('OpenAI costs request cancelled', 'AbortError');
    if (deadline.aborted) throw new Error('OPENAI_COSTS_TIMEOUT');
    if (error instanceof Error && /^OPENAI_COSTS_[A-Z_\d]+$/.test(error.message)) throw error;
    throw new Error('OPENAI_COSTS_REQUEST_FAILED');
  }
}
