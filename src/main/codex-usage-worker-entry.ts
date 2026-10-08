import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import type {
  UsageWorkerRequest,
  UsageWorkerResponse,
} from '@/main/extensions/codex-usage-investigator/worker-protocol';

const port = parentPort;
if (!port) throw new Error('Codex usage worker requires a parent port');
const data = z
  .object({ dataDirectory: z.string().min(1) })
  .strict()
  .parse(workerData);
const send = (message: UsageWorkerResponse) => port.postMessage(message);
const investigator = new CodexUsageInvestigator({ ...data, onTaskChanged: (task) => send({ kind: 'task', task }) });

async function execute(request: UsageWorkerRequest) {
  switch (request.method) {
    case 'state':
      return investigator.state(...request.args);
    case 'investigation':
      return investigator.investigation(...request.args);
    case 'start':
      return investigator.start(...request.args);
    case 'resume':
      return investigator.resume(...request.args);
    case 'resumeLatest':
      return investigator.resumeLatest();
    case 'pause':
      return investigator.pause();
    case 'cleanup':
      return investigator.cleanup(...request.args);
    case 'export':
      return investigator.export(...request.args);
  }
}

// Pause bypasses the queue so long reads and backups remain cancellable.
let queue: Promise<unknown> = Promise.resolve();
port.on('message', (request: UsageWorkerRequest) => {
  const run = async () => {
    try {
      send({ kind: 'result', id: request.id, value: await execute(request) });
    } catch (error) {
      send({ kind: 'result', id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  };
  if (request.method === 'pause') void run();
  else queue = queue.then(run, run);
});
