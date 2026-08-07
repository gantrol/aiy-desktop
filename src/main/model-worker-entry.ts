import { runModelWorker } from '@/main/model-worker/server';
import { parseModelWorkerErrorTarget } from '@/main/model-worker/protocol';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rawLaunchConfig = process.env.AIY_MODEL_WORKER_CONFIG;

void runModelWorker().catch((error) => {
  // The detached host owns no user-facing surface. Startup failures are
  // reported by the Electron client's bounded connection timeout.
  console.error('[model-worker]', error);
  try {
    const config = parseModelWorkerErrorTarget(rawLaunchConfig);
    if (config) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      mkdirSync(path.dirname(config.errorPath), { recursive: true });
      writeFileSync(
        config.errorPath,
        JSON.stringify({
          workerId: config.workerId,
          message: error instanceof Error ? error.message : String(error),
          code,
          stack: error instanceof Error ? error.stack : undefined,
          failedAt: new Date().toISOString(),
        }),
        'utf8',
      );
    }
  } catch {
    // The client still reports its bounded startup timeout if diagnostics fail.
  }
  process.exitCode = 1;
});
