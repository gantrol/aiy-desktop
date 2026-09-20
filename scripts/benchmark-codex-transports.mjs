import { parseArgs } from 'node:util';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { BenchError, errorCode, fixtures, responsesEndpoint } from './codex-bench/metrics.mjs';
import { runBenchmark } from './codex-bench/runner.mjs';

const HELP = `Codex / Responses latency probe (Node 22+; no dependencies)

Dry-run is the default. --live explicitly permits requests that may consume quota or money.
  --model ID --effort LEVEL         Required, exact model/effort; no model-name whitelist
  --routes app-server,responses    Default; either route can also run alone
  --proxy-url URL                  Full endpoint, e.g. http://127.0.0.1:8317/v1/responses
  --allow-remote                   Explicitly permit a non-loopback HTTPS proxy
  --speed standard|fast            Default standard; Fast may consume more credits
  --case smoke|json                Default smoke; built-in acceptance checks
  --prompt-file PATH               Optional custom UTF-8 prompt, up to 256 KiB; manual quality review
  --rounds N                       1..50, default 5; exactly N attempts per route, no hidden warmup
  --timeout-ms N                   100..600000, default 120000, per attempt including startup
  --codex-binary PATH              Native Codex executable; default codex; never run through a shell
  --out PATH                       New JSONL file; defaults to .tmp/codex-bench/<unique>.jsonl
  --live                          Run instead of showing the plan

Proxy key: AIY_CODEX_BENCH_PROXY_KEY environment variable, never a command-line argument.
App Server uses the existing ChatGPT sign-in. This probe does not import, copy or refresh OAuth tokens.
JSONL exports timings, counts, hashes, statuses and reported metadata; not prompts, answers or credentials.
No live inference runs in CI. Do not interpret fixture tests as upstream latency measurements.
`;

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: 'boolean' },
      live: { type: 'boolean', default: false },
      model: { type: 'string' },
      effort: { type: 'string' },
      routes: { type: 'string', default: 'app-server,responses' },
      'proxy-url': { type: 'string' },
      'allow-remote': { type: 'boolean', default: false },
      speed: { type: 'string', default: 'standard' },
      case: { type: 'string', default: 'smoke' },
      'prompt-file': { type: 'string' },
      rounds: { type: 'string', default: '5' },
      'timeout-ms': { type: 'string', default: '120000' },
      'codex-binary': { type: 'string', default: 'codex' },
      out: { type: 'string' },
    },
  });
  if (values.help) return { help: true };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(values.model ?? '')) throw new BenchError('MODEL_REQUIRED');
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(values.effort ?? '')) throw new BenchError('EFFORT_REQUIRED');
  const routes = values.routes.split(',');
  if (
    !routes.length ||
    new Set(routes).size !== routes.length ||
    routes.some((r) => !['app-server', 'responses'].includes(r))
  ) {
    throw new BenchError('INVALID_ROUTES');
  }
  const rounds = Number(values.rounds);
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 50) throw new BenchError('INVALID_ROUNDS');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new BenchError('INVALID_TIMEOUT');
  if (!['standard', 'fast'].includes(values.speed)) throw new BenchError('INVALID_SPEED');
  if (!Object.hasOwn(fixtures, values.case)) throw new BenchError('INVALID_CASE');
  const endpoint = routes.includes('responses') ? responsesEndpoint(values['proxy-url'], values['allow-remote']) : null;
  return {
    live: values.live,
    routes,
    rounds,
    timeoutMs,
    endpoint,
    binary: values['codex-binary'],
    request: {
      model: values.model,
      effort: values.effort,
      speed: values.speed,
    },
    fixture: fixtures[values.case],
    fixtureName: values['prompt-file'] ? 'custom' : values.case,
    promptFile: values['prompt-file'],
    out: values.out,
  };
}

async function loadPrompt(filename) {
  const file = await open(filename, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new BenchError('PROMPT_NOT_FILE');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (!used || used > 256 * 1024) throw new BenchError('INVALID_PROMPT_SIZE');
    const prompt = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used));
    return { prompt };
  } finally {
    await file.close();
  }
}

export async function main(args, environment = process.env) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!options.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          request: options.request,
          routes: options.routes,
          fixture: options.fixtureName,
          maximumClientAttempts: options.rounds * options.routes.length,
          message: 'No process started, file read or network request sent. Add --live to consume quota and measure.',
        },
        null,
        2,
      ),
    );
    return;
  }
  options.key = options.endpoint ? environment.AIY_CODEX_BENCH_PROXY_KEY : null;
  if (options.endpoint && (!options.key || /[\r\n]/.test(options.key))) throw new BenchError('PROXY_KEY_REQUIRED');
  if (options.promptFile) options.fixture = await loadPrompt(options.promptFile);
  const output = path.resolve(options.out ?? path.join('.tmp', 'codex-bench', `${Date.now()}-${randomUUID()}.jsonl`));
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const file = await open(output, 'wx', 0o600); // Do not overwrite existing files or follow an existing symlink.
  const controller = new AbortController();
  const stop = () => controller.abort(new BenchError('USER_CANCELLED'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const { samples, summary } = await runBenchmark(options, {
      signal: controller.signal,
      write: (row) => file.writeFile(JSON.stringify(row) + '\n'),
    });
    console.log(JSON.stringify({ output, ...summary }, null, 2));
    if (!summary.cleanupComplete || summary.cancelled || samples.some((s) => s.status !== 'completed'))
      process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await file.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(errorCode(error));
    process.exitCode = 1;
  });
}
