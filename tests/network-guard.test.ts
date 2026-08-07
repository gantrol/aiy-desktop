import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { BlockedOutboundRequestError } from './support/network-guard';
import { startOpenAiStub } from './support/openai-stub-server';

/**
 * The circuit breaker is the only thing standing between a careless test and a
 * provider invoice, so it is verified rather than assumed. If this file ever
 * fails, treat every other lane's cost guarantee as void.
 */
describe('test-lane outbound circuit breaker', () => {
  it('blocks fetch to a paid provider host', async () => {
    await expect(fetch('https://api.openai.com/v1/images/generations', { method: 'POST' })).rejects.toThrow(
      BlockedOutboundRequestError,
    );
  });

  it('blocks every provider host the product can be configured with', async () => {
    const hosts = [
      'https://api.openai.com/v1/models',
      'https://api.deepseek.com/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/models',
      'https://dashscope.aliyuncs.com/api/v1/services',
      'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    ];
    for (const host of hosts) {
      await expect(fetch(host)).rejects.toThrow(/blocked outbound/);
    }
  });

  it('blocks the node:http escape hatch as well as fetch', () => {
    expect(() => http.request('http://api.openai.com/v1/models')).toThrow(/blocked outbound/);
    expect(() => http.request({ hostname: 'api.openai.com', path: '/v1/models' })).toThrow(/blocked outbound/);
  });

  it('does not read provider credentials from the developer environment', () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it('lets loopback stubs through untouched', async () => {
    const stub = await startOpenAiStub();
    try {
      const response = await fetch(`${stub.url}/models`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ object: 'list' });
    } finally {
      await stub.close();
    }
  });
});
