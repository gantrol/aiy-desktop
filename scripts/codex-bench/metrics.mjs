import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export class BenchError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BenchError';
    this.code = code;
  }
}

// Never export upstream error messages, prompts, completions, or account identifiers.
export function errorCode(error, signal) {
  if (signal?.aborted) return signal.reason instanceof BenchError ? signal.reason.code : 'DEADLINE_EXCEEDED';
  return error instanceof BenchError ? error.code : 'TRANSPORT_ERROR';
}

export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const milliseconds = (value) => Math.round(value * 1000) / 1000;
export const elapsed = (start) => milliseconds(performance.now() - start);
export const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export function newSample(route, round, request) {
  return {
    route,
    round,
    phase: round === 0 ? 'first-sample' : 'subsequent-sample',
    requestedModel: request.model,
    requestedEffort: request.effort,
    requestedSpeed: request.speed,
    reportedModel: null,
    reportedModelSource: null,
    reportedServiceTier: null,
    status: 'pending',
    errorCode: null,
    timing: {
      startupMs: null,
      preflightMs: null,
      threadMs: null,
      acceptanceMs: null,
      headersMs: null,
      firstEventMs: null,
      firstReasoningDeltaMs: null,
      firstTextDeltaMs: null,
      requestMs: null,
      totalMs: null,
    },
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    },
    output: { bytes: null, sha256: null, validation: 'not-evaluated' },
    toolCalls: 0,
  };
}

export function finishOutput(sample, text, fixture) {
  if (typeof text !== 'string' || !text.trim()) throw new BenchError('EMPTY_OUTPUT');
  sample.output = {
    bytes: Buffer.byteLength(text),
    sha256: digest(text),
    validation: fixture.validate ? (fixture.validate(text) ? 'passed' : 'failed') : 'manual-review-required',
  };
  if (sample.output.validation === 'failed') throw new BenchError('OUTPUT_VALIDATION_FAILED');
  sample.status = 'completed';
}

export const fixtures = {
  smoke: {
    prompt: '只输出 OK，不加引号，不要解释，不要调用工具。',
    validate: (text) => text.trim() === 'OK',
  },
  json: {
    prompt: '不要调用工具。只返回 JSON：ok 为 true，count 为整数 3。不要其他字段或解释。',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' }, count: { type: 'integer' } },
      required: ['ok', 'count'],
      additionalProperties: false,
    },
    validate: (text) => {
      try {
        const value = JSON.parse(text);
        return value?.ok === true && value.count === 3 && Object.keys(value).length === 2;
      } catch {
        return false;
      }
    },
  },
};

export function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  return milliseconds(sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low));
}

export function summarize(samples) {
  const groups = Map.groupBy(
    samples,
    (s) =>
      `${s.route}:${s.phase}:${s.route === 'app-server' ? (s.processStarted ? 'started' : 'reused') : 'external-server'}`,
  );
  return [...groups].map(([group, rows]) => {
    const successful = rows.filter((s) => s.status === 'completed');
    const validated = successful.filter((s) => s.output.validation === 'passed');
    const result = {
      group,
      attempted: rows.length,
      completed: successful.length,
      validated: validated.length,
    };
    result.failureRate = (rows.length - successful.length) / rows.length;
    result.latency = {};
    // Performance aggregates require accepted output. Never turn an empty/failed run into a fast result.
    for (const field of ['totalMs', 'requestMs', 'firstTextDeltaMs']) {
      const values = validated.map((s) => s.timing[field]).filter((v) => Number.isFinite(v));
      result.latency[field] = {
        observed: values.length,
        p50: percentile(values, 0.5),
        p95: values.length >= 20 ? percentile(values, 0.95) : null,
      };
    }
    return result;
  });
}

export function responsesEndpoint(value, allowRemote = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BenchError('INVALID_PROXY_URL');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/responses') ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    (!loopback && !allowRemote)
  )
    throw new BenchError('UNSAFE_PROXY_URL');
  return url;
}

export async function* lines(chunks, maxBytes = 8 * 1024 * 1024, maxLineBytes = 1024 * 1024) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new BenchError('RESPONSE_TOO_LARGE');
    buffer += decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r\n|\n|\r/.exec(buffer))) {
      if (match[0] === '\r' && match.index === buffer.length - 1) break;
      const line = buffer.slice(0, match.index);
      if (Buffer.byteLength(line) > maxLineBytes) throw new BenchError('FRAME_TOO_LARGE');
      yield line;
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (Buffer.byteLength(buffer) > maxLineBytes) throw new BenchError('FRAME_TOO_LARGE');
  }
  buffer += decoder.decode();
  if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
  if (buffer) yield buffer;
}

export async function* sseEvents(chunks) {
  let data = [];
  let size = 0;
  for await (const line of lines(chunks)) {
    if (!line) {
      if (data.length) {
        const body = data.join('\n');
        if (body !== '[DONE]') {
          try {
            yield JSON.parse(body);
          } catch {
            throw new BenchError('INVALID_SSE_JSON');
          }
        }
      }
      data = [];
      size = 0;
    } else if (line.startsWith('data:')) {
      const part = line.slice(5).replace(/^ /, '');
      size += Buffer.byteLength(part);
      if (size > 1024 * 1024) throw new BenchError('FRAME_TOO_LARGE');
      data.push(part);
    }
  }
  // An unterminated SSE frame is not a completed response.
}
