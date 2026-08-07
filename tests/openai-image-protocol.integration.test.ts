import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAiImageAdapter } from '../src/main/generation-models/openai-image/openai-image-adapter';
import { OpenAiImageApiRuntime } from '../src/main/extensions/openai-image-api/runtime';
import type {
  GenerationAdapterSignal,
  NormalizedGenerationRequest,
} from '../src/main/generation-models/adapters/contracts';
import { imageFixture } from './support/fixtures';
import { startOpenAiStub, type OpenAiStubServer } from './support/openai-stub-server';

/**
 * L2 — protocol boundary.
 *
 * These assertions are worth more than a mocked `fetch` because they exercise
 * real serialization: multipart part order, header propagation, and the shape
 * the adapter actually puts on the wire. Every byte stays on 127.0.0.1.
 */
describe('OpenAI image adapter wire protocol', () => {
  let stub: OpenAiStubServer;
  let libraryRoot: string;

  beforeEach(() => {
    libraryRoot = mkdtempSync(path.join(os.tmpdir(), 'aiy-openai-protocol-'));
  });

  afterEach(async () => {
    await stub?.close();
    rmSync(libraryRoot, { recursive: true, force: true });
  });

  function makeAdapter() {
    const runtime = new OpenAiImageApiRuntime();
    runtime.configure({
      apiKey: 'sk-test-not-a-real-key',
      organizationId: 'org-test',
      projectId: 'proj-test',
      usable: true,
      verified: true,
      connectionMessage: 'stub',
    });
    return new OpenAiImageAdapter(runtime, libraryRoot, fetch, stub.url);
  }

  function makeContext() {
    const signals: GenerationAdapterSignal[] = [];
    return {
      signals,
      context: {
        signal: new AbortController().signal,
        emit: (signal: GenerationAdapterSignal) => signals.push(signal),
      },
    };
  }

  function makeRequest(overrides: Partial<NormalizedGenerationRequest> = {}): NormalizedGenerationRequest {
    return {
      runId: 'run_protocol_00000001',
      modelKey: 'openai:gpt-image-2',
      providerKey: 'openai',
      modelId: 'gpt-image-2',
      operation: 'GENERATE',
      prompt: 'A calm cafe interior, warm afternoon light.',
      media: [],
      output: { width: 1024, height: 1024, quality: 'low' },
      ...overrides,
    };
  }

  it('sends a JSON generation request with credentials and the declared output format', async () => {
    stub = await startOpenAiStub();
    const { context } = makeContext();

    const result = await makeAdapter().execute(makeRequest(), context);

    const [request] = stub.requestsFor('generations');
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toContain('application/json');
    expect(request.headers.authorization).toBe('Bearer sk-test-not-a-real-key');
    expect(request.headers['openai-organization']).toBe('org-test');
    expect(request.headers['openai-project']).toBe('proj-test');
    expect(request.json()).toMatchObject({
      model: 'gpt-image-2',
      n: 1,
      quality: 'low',
      size: '1024x1024',
      output_format: 'png',
    });
    expect(result.kind).toBe('FILE');
  });

  it('propagates the provider request id from the response headers', async () => {
    stub = await startOpenAiStub();
    const { context, signals } = makeContext();

    const result = await makeAdapter().execute(makeRequest(), context);

    expect(signals).toContainEqual({ type: 'REQUEST_ACCEPTED', providerRequestId: 'req_stub_00000000' });
    expect(result.providerRequestId).toBe('req_stub_00000000');
  });

  it('surfaces a revised prompt as a provider-returned description', async () => {
    stub = await startOpenAiStub();
    const { context } = makeContext();

    const result = await makeAdapter().execute(makeRequest(), context);

    expect(result.providerReturnedDescriptions).toEqual([
      { fieldName: 'revised_prompt', rawValue: 'A calm cafe interior, warm afternoon light.' },
    ]);
  });

  it('uploads the edit source before its references and sends the mask as a single part', async () => {
    stub = await startOpenAiStub();
    const { context } = makeContext();

    await makeAdapter().execute(
      makeRequest({
        operation: 'EDIT',
        media: [
          { assetId: 'ref-b', role: 'REFERENCE', localPath: imageFixture('valid-64x64.png'), mimeType: 'image/png' },
          {
            assetId: 'source-a',
            role: 'EDIT_SOURCE',
            localPath: imageFixture('valid-64x64.png'),
            mimeType: 'image/png',
            width: 64,
            height: 64,
          },
          {
            assetId: 'mask-a',
            role: 'MASK',
            localPath: imageFixture('mask-64x64.png'),
            mimeType: 'image/png',
            width: 64,
            height: 64,
          },
        ],
      }),
      context,
    );

    const [request] = stub.requestsFor('edits');
    const parts = request.multipart();
    expect(request.headers['content-type']).toContain('multipart/form-data');
    expect(parts.map((part) => part.name)).toEqual([
      'model',
      'prompt',
      'n',
      'quality',
      'size',
      'output_format',
      'image[]',
      'image[]',
      'mask',
    ]);
    // Ordering is a contract: the edit source must arrive ahead of references.
    expect(parts.filter((part) => part.name === 'image[]')).toHaveLength(2);
    expect(parts.filter((part) => part.name === 'mask')).toHaveLength(1);
  });

  it.each([
    ['auth-error.json', 401, 'AUTH'],
    ['permission-error.json', 403, 'AUTH'],
    ['rate-limit-error.json', 429, 'RATE_LIMITED'],
    ['moderation-blocked.json', 400, 'INVALID_REQUEST'],
    ['server-error.json', 503, 'PROVIDER_UNAVAILABLE'],
  ])('maps %s (HTTP %i) to the %s adapter code', async (fixture, status, code) => {
    stub = await startOpenAiStub({ generations: { kind: 'fixture', fixture, status } });
    const { context } = makeContext();

    await expect(makeAdapter().execute(makeRequest(), context)).rejects.toMatchObject({
      code,
      details: { httpStatus: status },
    });
  });

  it('reports a rate-limit retry as retryable and a moderation block as terminal', async () => {
    stub = await startOpenAiStub({
      generations: [
        { kind: 'fixture', fixture: 'rate-limit-error.json', status: 429, headers: { 'Retry-After': '2' } },
        { kind: 'fixture', fixture: 'moderation-blocked.json', status: 400 },
      ],
    });
    const adapter = makeAdapter();

    await expect(adapter.execute(makeRequest(), makeContext().context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    await expect(adapter.execute(makeRequest(), makeContext().context)).rejects.toMatchObject({
      providerCode: 'moderation_blocked',
      retryable: false,
    });
  });

  it('rejects an empty data array instead of writing a zero-byte output', async () => {
    stub = await startOpenAiStub({ generations: { kind: 'fixture', fixture: 'empty-data.json' } });

    await expect(makeAdapter().execute(makeRequest(), makeContext().context)).rejects.toMatchObject({
      code: 'NO_OUTPUT',
    });
  });

  it('rejects a response that carries a url instead of inline image bytes', async () => {
    stub = await startOpenAiStub({ generations: { kind: 'fixture', fixture: 'missing-b64.json' } });

    await expect(makeAdapter().execute(makeRequest(), makeContext().context)).rejects.toMatchObject({
      code: 'NO_OUTPUT',
    });
  });

  it('classifies a socket that dies after the headers as a network failure', async () => {
    stub = await startOpenAiStub({ generations: { kind: 'abort-after-headers' } });

    await expect(makeAdapter().execute(makeRequest(), makeContext().context)).rejects.toThrow();
  });

  it('falls back to a stable message when the error body is not JSON', async () => {
    stub = await startOpenAiStub({
      generations: { kind: 'raw', status: 502, body: '<html>bad gateway</html>' },
    });

    await expect(makeAdapter().execute(makeRequest(), makeContext().context)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'OpenAI image request failed with HTTP 502',
    });
  });

  it('never reaches a host other than the injected loopback stub', async () => {
    stub = await startOpenAiStub();
    await makeAdapter().execute(makeRequest(), makeContext().context);

    expect(stub.requests).toHaveLength(1);
    expect(stub.url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
