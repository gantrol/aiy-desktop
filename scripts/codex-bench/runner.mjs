import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { AppServerProbe } from './app-server.mjs';
import { runResponses } from './responses.mjs';
import { BenchError, digest, elapsed, errorCode, newSample, summarize } from './metrics.mjs';

export async function runBenchmark(options, dependencies = {}) {
  const { request, fixture, endpoint, key, rounds, timeoutMs, routes, binary } = options;
  const write = dependencies.write ?? (() => {});
  const signal = dependencies.signal ?? new AbortController().signal;
  const directory = routes.includes('app-server') ? await mkdtemp(path.join(tmpdir(), 'aiy-codex-bench-')) : null;
  const app = directory
    ? (dependencies.appFactory ?? ((...args) => new AppServerProbe(...args)))(binary, directory)
    : null;
  const proxy = dependencies.proxy ?? runResponses;
  const samples = [];
  let cleanupComplete = true;
  try {
    await write({
      type: 'metadata',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      node: process.version,
      fixture: options.fixtureName,
      promptSha256: digest(fixture.prompt),
      promptBytes: Buffer.byteLength(fixture.prompt),
      request,
      routes,
      rounds,
      maximumClientAttempts: routes.length * rounds,
      endpointFingerprint: endpoint ? digest(endpoint.href) : null,
      limitations: [
        'Standalone protocol probe; not the complete AIY UI/job pipeline or identical upstream wire requests.',
        'Codex built-in context differs from Responses. Same account, model weights, effective effort, tier and proxy retries are not attested.',
        'First sample is not guaranteed to be cache-cold; proxy process startup is not measured.',
        'Client attempts do not cap upstream retries, total model requests, token usage or spending.',
        'No tool workflow, image/video generation or model-quality equivalence is tested.',
      ],
    });
    for (let round = 0; round < rounds && !signal.aborted; round += 1) {
      // AB / BA ordering limits a fixed first-run/order bias. It does not eliminate cache or load confounders.
      const order = round % 2 ? [...routes].reverse() : routes;
      for (const route of order) {
        if (signal.aborted) break;
        const sample = newSample(route, round, request);
        const started = performance.now();
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new BenchError('DEADLINE_EXCEEDED')), timeoutMs);
        const combined = AbortSignal.any([signal, deadline.signal]);
        try {
          const input = {
            request,
            fixture,
            signal: combined,
            sample,
            endpoint,
            key,
          };
          if (route === 'app-server') await app.run(input);
          else await proxy(input);
        } catch (error) {
          sample.errorCode = errorCode(error, combined);
          sample.status = combined.aborted ? 'cancelled-or-timeout' : 'failed';
        } finally {
          clearTimeout(timer);
          sample.timing.totalMs = elapsed(started);
          samples.push(sample);
          await write({ type: 'sample', ...sample });
        }
        if (route === 'app-server' && sample.status !== 'completed') {
          cleanupComplete = await app.close();
          if (!cleanupComplete) throw new BenchError('PROCESS_CLEANUP_INCOMPLETE');
        }
      }
    }
  } finally {
    if (app) cleanupComplete = (await app.close()) && cleanupComplete;
    // Never remove a workspace while an unconfirmed child may still be using it.
    if (directory && cleanupComplete) await rm(directory, { recursive: true, force: true });
  }
  const summary = {
    type: 'summary',
    groups: summarize(samples),
    cleanupComplete,
    cancelled: signal.aborted,
    conclusion: 'Descriptive measurements only; no automatic winner, price estimate or transport speedup claim.',
  };
  await write(summary);
  return { samples, summary };
}
