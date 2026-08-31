import { lstat, readFile } from 'node:fs/promises';
import process from 'node:process';
import type { ZodType } from 'zod';
import { z } from 'zod';
import {
  agentWeiboActionAvailable,
  runAgentWeiboAction,
  type AgentWeiboActionRuntimeOptions,
} from '@/main/agent-cli/weibo-action';
import { resolveAgentCliWorkspace } from '@/main/agent-cli/workspace';
import { AgentCliWorkerClient } from '@/main/agent-cli/worker-client';
import { MODEL_WORKER_PROTOCOL_VERSION, type ModelWorkerMethod } from '@/main/model-worker/protocol';
import {
  AIY_AGENT_PROTOCOL_VERSION,
  agentAssetImportRequestSchema,
  agentAssetImportResultSchema,
  agentDraftPrepareRequestSchema,
  agentDraftPrepareResultSchema,
  agentGenerationStartRequestSchema,
  agentGenerationStartResultSchema,
  agentJobCancelRequestSchema,
  agentJobCancelResultSchema,
  agentJobGetRequestSchema,
  agentJobResultSchema,
  agentWeiboHandoffRequestSchema,
  type AgentWeiboHandoffRequest,
} from '@/shared/contracts/agent-cli';

const MAX_REQUEST_BYTES = 1024 * 1024;

interface ParsedArguments {
  command: string;
  inputPath?: string;
  userDataPath?: string;
}

function cliError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function usage() {
  return `AIY agent CLI

Usage:
  aiy-agent capabilities [--user-data-dir PATH]
  aiy-agent asset import --input REQUEST.json [--user-data-dir PATH]
  aiy-agent draft prepare --input REQUEST.json [--user-data-dir PATH]
  aiy-agent generation start --input REQUEST.json [--user-data-dir PATH]
  aiy-agent job get --input REQUEST.json [--user-data-dir PATH]
  aiy-agent job cancel --input REQUEST.json [--user-data-dir PATH]
  aiy-agent action send-weibo --input REQUEST.json [--user-data-dir PATH]

Use --input - to read one JSON request from stdin. All command results are JSON.`;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { command: 'help' };
  const positionals: string[] = [];
  let inputPath: string | undefined;
  let userDataPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') {
      inputPath = argv[index + 1];
      index += 1;
      if (!inputPath) throw cliError('AIY_AGENT_INVALID_ARGUMENTS', '--input requires a file path or -');
      continue;
    }
    if (argument === '--user-data-dir') {
      userDataPath = argv[index + 1];
      index += 1;
      if (!userDataPath) throw cliError('AIY_AGENT_INVALID_ARGUMENTS', '--user-data-dir requires a path');
      continue;
    }
    if (argument.startsWith('-')) throw cliError('AIY_AGENT_INVALID_ARGUMENTS', `Unknown option: ${argument}`);
    positionals.push(argument);
  }
  const command = positionals.join(' ');
  const supported = [
    'capabilities',
    'asset import',
    'draft prepare',
    'generation start',
    'job get',
    'job cancel',
    'action send-weibo',
  ];
  if (!supported.includes(command)) throw cliError('AIY_AGENT_INVALID_ARGUMENTS', `Unknown command: ${command}`);
  if (command !== 'capabilities' && !inputPath) {
    throw cliError('AIY_AGENT_INVALID_ARGUMENTS', `${command} requires --input REQUEST.json or --input -`);
  }
  return { command, inputPath, userDataPath };
}

async function readStdin() {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BYTES) throw cliError('AIY_AGENT_INPUT_TOO_LARGE', 'JSON request exceeds 1 MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readRequest(pathOrStdin: string) {
  let source: string;
  if (pathOrStdin === '-') {
    source = await readStdin();
  } else {
    try {
      const stats = await lstat(pathOrStdin);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > MAX_REQUEST_BYTES) {
        throw new Error('invalid request file');
      }
      source = await readFile(pathOrStdin, 'utf8');
    } catch {
      throw cliError('AIY_AGENT_INVALID_INPUT_FILE', 'JSON request must be a plain file no larger than 1 MB');
    }
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw cliError('AIY_AGENT_INVALID_JSON', 'Request contains malformed JSON');
  }
}

function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const diagnostics = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ');
  throw cliError('AIY_AGENT_INVALID_INPUT', diagnostics);
}

const commandDefinitions = {
  'asset import': {
    method: 'agent.asset.import',
    input: agentAssetImportRequestSchema,
    output: agentAssetImportResultSchema,
  },
  'draft prepare': {
    method: 'agent.draft.prepare',
    input: agentDraftPrepareRequestSchema,
    output: agentDraftPrepareResultSchema,
  },
  'generation start': {
    method: 'agent.generation.start',
    input: agentGenerationStartRequestSchema,
    output: agentGenerationStartResultSchema,
  },
  'job get': { method: 'agent.job.get', input: agentJobGetRequestSchema, output: agentJobResultSchema },
  'job cancel': {
    method: 'agent.job.cancel',
    input: agentJobCancelRequestSchema,
    output: agentJobCancelResultSchema,
  },
} as const;

function exitCode(code: string) {
  if (code.includes('INVALID') || code.includes('UNSUPPORTED') || code.includes('LIMIT')) return 2;
  if (code.includes('UNAVAILABLE') || code.includes('NOT_FOUND') || code.includes('PROTOCOL')) return 3;
  if (code.includes('CONFLICT') || code.includes('ALREADY_STARTED')) return 4;
  if (code.includes('CANCELLED')) return 130;
  return 5;
}

function errorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return { code: 'AIY_AGENT_INVALID_RESULT', message: 'AIY returned an invalid result' };
  }
  const message = error instanceof Error ? error.message : String(error);
  const sourceCode =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'AIY_AGENT_OPERATION_FAILED';
  const code = sourceCode.startsWith('AIY_AGENT_')
    ? sourceCode
    : sourceCode === 'MODEL_WORKER_INVALID_PARAMS'
      ? 'AIY_AGENT_INVALID_INPUT'
      : sourceCode.startsWith('WORKER_')
        ? 'AIY_AGENT_WORKER_UNAVAILABLE'
        : 'AIY_AGENT_OPERATION_FAILED';
  return { code, message, ...(sourceCode === code ? {} : { sourceCode }) };
}

export async function runAgentCli(
  argv = process.argv.slice(2),
  runtimeOptions: AgentWeiboActionRuntimeOptions = { appPath: process.cwd(), resourcesPath: process.cwd() },
) {
  let command = 'unknown';
  let client: AgentCliWorkerClient | null = null;
  try {
    const argumentsValue = parseArguments(argv);
    command = argumentsValue.command;
    if (command === 'help') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }

    let operation:
      | {
          kind: 'worker';
          definition: (typeof commandDefinitions)[keyof typeof commandDefinitions];
          input: unknown;
        }
      | { kind: 'send-weibo'; input: AgentWeiboHandoffRequest }
      | null = null;
    if (command !== 'capabilities') {
      const rawInput = await readRequest(argumentsValue.inputPath!);
      if (command === 'action send-weibo') {
        operation = { kind: 'send-weibo', input: parseInput(agentWeiboHandoffRequestSchema, rawInput) };
      } else {
        const definition = commandDefinitions[command as keyof typeof commandDefinitions];
        operation = {
          kind: 'worker',
          definition,
          input: parseInput(definition.input as ZodType<unknown>, rawInput),
        };
      }
    }

    const workspace = await resolveAgentCliWorkspace(argumentsValue.userDataPath);
    client = await AgentCliWorkerClient.connect(workspace.descriptor);
    const library = {
      id: workspace.library.id,
      name: workspace.library.name,
      rootPath: workspace.library.rootPath,
    };
    let data: unknown;
    if (command === 'capabilities') {
      data = {
        cliProtocolVersion: AIY_AGENT_PROTOCOL_VERSION,
        workerProtocolVersion: MODEL_WORKER_PROTOCOL_VERSION,
        library,
        attachmentContract: {
          pathIngressCommand: 'asset import',
          acceptedPathKinds: ['absolute-local-file'],
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          maximumFileBytes: 25 * 1024 * 1024,
          maximumReferencesPerDraft: 8,
          chatOnlyAttachmentsAccepted: false,
          remoteUrlsAccepted: false,
        },
        commandActions: agentWeiboActionAvailable(runtimeOptions)
          ? [
              {
                key: 'send-weibo',
                command: 'action send-weibo',
                target: 'weibo',
                source: 'completed-generation-job',
                stagesGeneratedImages: true,
                opensBrowserCompanion: true,
                finalPublicationRequiresUser: true,
              },
            ]
          : [],
        routes: client.snapshot.imageGenerationRoutes,
      };
    } else if (operation?.kind === 'send-weibo') {
      data = await runAgentWeiboAction({
        client,
        workspace,
        request: operation.input,
        runtimeOptions,
      });
    } else {
      data = operation!.definition.output.parse(
        await client.request(operation!.definition.method as ModelWorkerMethod, [operation!.input]),
      );
    }
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: AIY_AGENT_PROTOCOL_VERSION, ok: true, command, data })}\n`,
    );
    return 0;
  } catch (error) {
    const details = errorDetails(error);
    process.stderr.write(`${details.code}: ${details.message}\n`);
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: AIY_AGENT_PROTOCOL_VERSION, ok: false, command, error: details })}\n`,
    );
    return exitCode(details.code);
  } finally {
    client?.close();
  }
}
