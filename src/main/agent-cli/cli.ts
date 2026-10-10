import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ZodType } from 'zod';
import { z } from 'zod';
import {
  agentWorkCapabilities,
  agentWorkReadSchema,
  agentWorkReadResultSchema,
  agentWorkListSchema,
  agentWorkListResultSchema,
  agentWorkMutateSchema,
  agentWorkMutateResultSchema,
} from '@/shared/contracts/agent-work';
import { agentPermissionsSchema } from '@/shared/contracts/agent-permissions';
import {
  agentCreationCapabilities,
  agentCreationAlbumsSchema,
  agentCreationAlbumsResultSchema,
  agentCreationDeleteEmptyAlbumsSchema,
  agentCreationDeleteEmptyAlbumsResultSchema,
  agentCreationEnsureAlbumSchema,
  agentCreationEnsureAlbumResultSchema,
  agentCreationMoveSchema,
  agentCreationMoveResultSchema,
} from '@/shared/contracts/agent-creation';
import {
  agentAlbumCapabilities,
  agentAlbumListRequestSchema,
  agentAlbumListResultSchema,
  agentAlbumEnsureRequestSchema,
  agentAlbumEnsureResultSchema,
  agentAlbumAddRequestSchema,
  agentAlbumAddResultSchema,
  agentAlbumRemoveRequestSchema,
  agentAlbumRemoveResultSchema,
} from '@/shared/contracts/agent-album';
import {
  agentContentCapabilities,
  agentContentReadRequestSchema,
  agentContentReadResultSchema,
  agentContentSearchRequestSchema,
  agentContentSearchResultSchema,
  agentContentUpdateRequestSchema,
  agentContentUpdateResultSchema,
} from '@/shared/contracts/agent-content';
import {
  agentIntakeCapabilities,
  agentIntakeImportRequestSchema,
  agentIntakeGetRequestSchema,
  agentIntakeResultSchema,
} from '@/shared/contracts/agent-intake';
import {
  agentWeiboActionAvailable,
  runAgentWeiboAction,
  type AgentWeiboActionRuntimeOptions,
} from '@/main/agent-cli/weibo-action';
import { resolveAgentCliWorkspace } from '@/main/agent-cli/workspace';
import { AgentCliWorkerClient } from '@/main/agent-cli/worker-client';
import { isHandoffCommand, runHandoffCommand } from '@/main/agent-cli/handoff-command';
import { MODEL_WORKER_PROTOCOL_VERSION, type ModelWorkerMethod } from '@/main/model-worker/protocol';
import {
  contentPackPreviewCommandSchema,
  contentPackApplyCommandSchema,
  contentPackPreviewCommandResultSchema,
  contentPackApplyCommandResultSchema,
  contentPackCommandCapabilities,
} from '@/shared/contracts/content-pack-command';
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
  aiy-agent work list --input REQUEST.json [--user-data-dir PATH]
  aiy-agent work read --input REQUEST.json [--user-data-dir PATH]
  aiy-agent work mutate --input REQUEST.json [--user-data-dir PATH]
  aiy-agent creation albums --input REQUEST.json [--user-data-dir PATH]
  aiy-agent creation ensure-album --input REQUEST.json [--user-data-dir PATH]
  aiy-agent creation move --input REQUEST.json [--user-data-dir PATH]
  aiy-agent creation delete-empty-albums --input REQUEST.json [--user-data-dir PATH]
  aiy-agent content read --input REQUEST.json [--user-data-dir PATH]
  aiy-agent content search --input REQUEST.json [--user-data-dir PATH]
  aiy-agent content update --input REQUEST.json [--user-data-dir PATH]
  aiy-agent handoff prepare --input REQUEST.json
  aiy-agent handoff verify --input PACKET.json
  aiy-agent asset import --input REQUEST.json [--user-data-dir PATH]
  aiy-agent intake import --input REQUEST.json [--user-data-dir PATH]
  aiy-agent intake get --input REQUEST.json [--user-data-dir PATH]
  aiy-agent album list --input REQUEST.json [--user-data-dir PATH]
  aiy-agent album ensure --input REQUEST.json [--user-data-dir PATH]
  aiy-agent album add --input REQUEST.json [--user-data-dir PATH]
  aiy-agent album remove --input REQUEST.json [--user-data-dir PATH]
  aiy-agent pack preview --input REQUEST.json [--user-data-dir PATH]
  aiy-agent pack apply --input REQUEST.json [--user-data-dir PATH]
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
    'work list',
    'work read',
    'work mutate',
    'creation albums',
    'creation ensure-album',
    'creation move',
    'creation delete-empty-albums',
    'capabilities',
    'content read',
    'content search',
    'content update',
    'handoff prepare',
    'handoff verify',
    'asset import',
    'intake import',
    'intake get',
    'album list',
    'album ensure',
    'album add',
    'album remove',
    'pack preview',
    'pack apply',
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
  if (isHandoffCommand(command) && userDataPath)
    throw cliError('AIY_AGENT_INVALID_ARGUMENTS', 'Offline handoffs do not accept --user-data-dir');
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
  'creation albums': {
    method: 'agent.creation.albums',
    input: agentCreationAlbumsSchema,
    output: agentCreationAlbumsResultSchema,
  },
  'creation ensure-album': {
    method: 'agent.creation.ensure-album',
    input: agentCreationEnsureAlbumSchema,
    output: agentCreationEnsureAlbumResultSchema,
    refreshFileView: true,
  },
  'creation move': {
    method: 'agent.creation.move',
    input: agentCreationMoveSchema,
    output: agentCreationMoveResultSchema,
    refreshFileView: true,
  },
  'creation delete-empty-albums': {
    method: 'agent.creation.delete-empty-albums',
    input: agentCreationDeleteEmptyAlbumsSchema,
    output: agentCreationDeleteEmptyAlbumsResultSchema,
    refreshFileView: true,
  },
  'work list': { method: 'agent.work.list', input: agentWorkListSchema, output: agentWorkListResultSchema },
  'work read': { method: 'agent.work.read', input: agentWorkReadSchema, output: agentWorkReadResultSchema },
  'work mutate': { method: 'agent.work.mutate', input: agentWorkMutateSchema, output: agentWorkMutateResultSchema },
  'album list': {
    method: 'agent.album.list',
    input: agentAlbumListRequestSchema,
    output: agentAlbumListResultSchema,
  },
  'album ensure': {
    method: 'agent.album.ensure',
    input: agentAlbumEnsureRequestSchema,
    output: agentAlbumEnsureResultSchema,
    refreshFileView: true,
  },
  'album add': {
    method: 'agent.album.add',
    input: agentAlbumAddRequestSchema,
    output: agentAlbumAddResultSchema,
    refreshFileView: true,
  },
  'album remove': {
    method: 'agent.album.remove',
    input: agentAlbumRemoveRequestSchema,
    output: agentAlbumRemoveResultSchema,
    refreshFileView: true,
  },
  'content search': {
    method: 'agent.content.search',
    input: agentContentSearchRequestSchema,
    output: agentContentSearchResultSchema,
  },
  'content update': {
    method: 'agent.content.update',
    input: agentContentUpdateRequestSchema,
    output: agentContentUpdateResultSchema,
  },
  'content read': {
    method: 'agent.content.read',
    input: agentContentReadRequestSchema,
    output: agentContentReadResultSchema,
  },
  'pack preview': {
    method: 'agent.pack.preview',
    input: contentPackPreviewCommandSchema,
    output: contentPackPreviewCommandResultSchema,
  },
  'pack apply': {
    method: 'agent.pack.apply',
    input: contentPackApplyCommandSchema,
    output: contentPackApplyCommandResultSchema,
  },
  'intake import': {
    method: 'agent.intake.import',
    input: agentIntakeImportRequestSchema,
    output: agentIntakeResultSchema,
    refreshFileView: true,
  },
  'intake get': {
    method: 'agent.intake.get',
    input: agentIntakeGetRequestSchema,
    output: agentIntakeResultSchema,
  },
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
    if (isHandoffCommand(command)) {
      const data = runHandoffCommand(command, await readRequest(argumentsValue.inputPath!));
      process.stdout.write(
        `${JSON.stringify({ protocolVersion: AIY_AGENT_PROTOCOL_VERSION, ok: true, command, data })}\n`,
      );
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
    client = await AgentCliWorkerClient.connect(
      workspace.descriptor,
      path.join(runtimeOptions.appPath, 'out', 'main', 'model-worker.js'),
    );
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
        permissions: agentPermissionsSchema.parse(await client.request('agent.permissions.read', [])),
        workTracking: agentWorkCapabilities,
        creations: agentCreationCapabilities,
        content: agentContentCapabilities,
        intake: agentIntakeCapabilities,
        albums: agentAlbumCapabilities,
        contentPacks: contentPackCommandCapabilities,
        offlineHandoffs: {
          commands: ['handoff prepare', 'handoff verify'],
          opensLibrary: false,
          executesAgent: false,
          verifiesRemoteState: false,
        },
        attachmentContract: {
          pathIngressCommand: 'asset import',
          acceptedPathKinds: ['absolute-local-file'],
          acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          maximumFileBytes: 25 * 1024 * 1024,
          maximumReferencesPerDraft: 8,
          chatOnlyAttachmentsAccepted: false,
          remoteUrlsAccepted: false,
        },
        commandActions: (await agentWeiboActionAvailable(runtimeOptions))
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
      if ('refreshFileView' in operation!.definition) {
        try {
          await client.request('agent.file-view.refresh', []);
        } catch (error) {
          // The mutation is already committed; a derived-view failure must not invite another import.
          process.stderr.write(
            `AIY_AGENT_FILE_VIEW_REFRESH_PENDING: Content committed; ${errorDetails(error).message}\n`,
          );
        }
      }
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
