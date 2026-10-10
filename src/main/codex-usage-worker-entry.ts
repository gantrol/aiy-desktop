import { z } from 'zod';
import { extensionProcessPort } from '@/main/extensions/process-port';
import { writeWorkerDiagnostic } from '@/main/extensions/worker-diagnostics';
import { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import type {
  UsageWorkerRequest,
  UsageWorkerResponse,
} from '@/main/extensions/codex-usage-investigator/worker-protocol';

const port = extensionProcessPort();
writeWorkerDiagnostic('worker-ready');
const send = (message: UsageWorkerResponse) => port.send(message);
let investigator: CodexUsageInvestigator;

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
port.listen((message) => {
  if (!investigator) {
    const { dataDirectory } = z
      .object({ kind: z.literal('configure'), dataDirectory: z.string().min(1) })
      .strict()
      .parse(message);
    investigator = new CodexUsageInvestigator({ dataDirectory, onTaskChanged: (task) => send({ kind: 'task', task }) });
    return;
  }
  const request = message as UsageWorkerRequest;
  const run = async () => {
    writeWorkerDiagnostic('command-started', { requestId: request.id, operation: request.method });
    try {
      send({ kind: 'result', id: request.id, value: await execute(request) });
      writeWorkerDiagnostic('command-finished', { requestId: request.id });
    } catch (error) {
      writeWorkerDiagnostic('command-failed', { requestId: request.id }, error);
      send({ kind: 'result', id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  };
  if (request.method === 'pause') void run();
  else queue = queue.then(run, run);
});
