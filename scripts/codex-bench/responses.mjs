import { performance } from 'node:perf_hooks';
import { BenchError, count, elapsed, finishOutput, sseEvents } from './metrics.mjs';

function captureMetadata(sample, response) {
  if (!response || typeof response !== 'object') return;
  if (typeof response.model === 'string') {
    sample.reportedModel = response.model.slice(0, 200);
    sample.reportedModelSource = 'response.model (proxy-reported, not identity attestation)';
  }
  if (typeof response.service_tier === 'string') sample.reportedServiceTier = response.service_tier.slice(0, 100);
  if (response.usage) {
    const usage = response.usage;
    sample.usage = {
      inputTokens: count(usage.input_tokens),
      cachedInputTokens: count(usage.input_tokens_details?.cached_tokens),
      outputTokens: count(usage.output_tokens),
      reasoningOutputTokens: count(usage.output_tokens_details?.reasoning_tokens),
    };
  }
}

async function checkedFetch(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new BenchError(`HTTP_${response.status}`);
  }
  return response;
}

async function readCatalog(response) {
  let length = 0;
  const parts = [];
  for await (const part of response.body) {
    length += part.byteLength;
    if (length > 2 * 1024 * 1024) throw new BenchError('CATALOG_TOO_LARGE');
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new BenchError('INVALID_CATALOG');
  }
}

export async function runResponses({ endpoint, key, request, fixture, signal, sample }) {
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const preflight = performance.now();
  try {
    const models = new URL(endpoint);
    models.pathname = models.pathname.replace(/\/responses$/, '/models');
    const catalog = await readCatalog(await checkedFetch(models, { headers, signal }));
    if (!Array.isArray(catalog.data)) throw new BenchError('INVALID_CATALOG');
    if (!catalog.data.some((model) => model.id === request.model)) throw new BenchError('MODEL_NOT_LISTED');
  } finally {
    sample.timing.preflightMs = elapsed(preflight);
  }

  const started = performance.now();
  const body = {
    model: request.model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: fixture.prompt }] }],
    instructions: 'Complete the supplied text task without tools.',
    reasoning: { effort: request.effort },
    service_tier: request.speed === 'fast' ? 'priority' : 'default',
    tools: [],
    tool_choice: 'none',
    stream: true,
    store: false,
    ...(fixture.schema
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: 'bench',
              strict: true,
              schema: fixture.schema,
            },
          },
        }
      : {}),
  };
  let completed = null;
  const outputs = new Map();
  try {
    const response = await checkedFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    sample.timing.headersMs = elapsed(started);
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      await response.body?.cancel();
      throw new BenchError('SSE_REQUIRED');
    }
    for await (const event of sseEvents(response.body)) {
      sample.timing.firstEventMs ??= elapsed(started);
      captureMetadata(sample, event.response);
      if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
        throw new BenchError('UPSTREAM_TERMINAL_FAILURE');
      }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta.length) {
        sample.timing.firstTextDeltaMs ??= elapsed(started);
      }
      if (/^response\.reasoning.*\.delta$/.test(event.type) && typeof event.delta === 'string' && event.delta.length) {
        sample.timing.firstReasoningDeltaMs ??= elapsed(started);
      }
      if (event.item && ['response.output_item.added', 'response.output_item.done'].includes(event.type)) {
        if (!['message', 'reasoning'].includes(event.item.type)) {
          sample.toolCalls += 1;
          throw new BenchError('TOOL_USE_NOT_ALLOWED');
        }
        if (event.type === 'response.output_item.done') outputs.set(event.output_index ?? event.item.id, event.item);
      }
      if (event.type === 'response.completed') {
        if (!event.response || event.response.status !== 'completed') throw new BenchError('INVALID_COMPLETION');
        completed = event.response;
        break;
      }
    }
    if (!completed) throw new BenchError('STREAM_ENDED_WITHOUT_COMPLETION');
    if (sample.reportedModel && sample.reportedModel !== request.model) throw new BenchError('REPORTED_MODEL_MISMATCH');
    const items = completed.output?.length
      ? completed.output
      : [...outputs.entries()]
          .sort(([a], [b]) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0))
          .map(([, item]) => item);
    if (!Array.isArray(items) || items.some((item) => !['message', 'reasoning'].includes(item.type))) {
      throw new BenchError('TOOL_USE_NOT_ALLOWED');
    }
    const text = items
      .flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []))
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text)
      .join('');
    finishOutput(sample, text, fixture);
  } finally {
    sample.timing.requestMs = elapsed(started);
  }
}
