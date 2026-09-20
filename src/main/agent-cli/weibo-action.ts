import path from 'node:path';
import { access } from 'node:fs/promises';
import { AgentWeiboActionReceiptStore } from '@/main/agent-cli/weibo-action-receipts';
import type { AgentCliWorkspace } from '@/main/agent-cli/workspace';
import type { AgentCliWorkerClient } from '@/main/agent-cli/worker-client';
import { BrowserCompanionBrowserController } from '@/main/browser-companion/browser-controller';
import { BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';
import {
  createBrowserCompanionBridgeUrl,
  readBrowserCompanionCredentials,
} from '@/main/browser-companion/loopback-credentials';
import { BrowserCompanionRuntime } from '@/main/browser-companion/runtime';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { loadExtensionPackage } from '@/main/extensions/package-loader';
import {
  AIY_AGENT_PROTOCOL_VERSION,
  agentJobResultSchema,
  agentWeiboHandoffResultSchema,
  type AgentJobResult,
  type AgentWeiboHandoffRequest,
  type AgentWeiboHandoffResult,
} from '@/shared/contracts/agent-cli';
import { WEIBO_CHANNEL_EXTENSION_ID } from '@/shared/extension-ids';

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

type JobOutput = NonNullable<AgentJobResult['runs'][number]['output']>;

export interface AgentWeiboActionRuntimeOptions {
  appPath: string;
  resourcesPath: string;
}

function actionError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function weiboChannelPackagePath(options: AgentWeiboActionRuntimeOptions) {
  const candidates = [
    path.join(path.resolve(options.resourcesPath), 'extensions', WEIBO_CHANNEL_EXTENSION_ID),
    path.join(path.resolve(options.appPath), 'extensions', WEIBO_CHANNEL_EXTENSION_ID),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export async function agentWeiboActionAvailable(options: AgentWeiboActionRuntimeOptions) {
  const packagePath = await weiboChannelPackagePath(options);
  if (!packagePath) return false;
  try {
    return (await loadExtensionPackage(packagePath, 'BUILT_IN')).manifest.id === WEIBO_CHANNEL_EXTENSION_ID;
  } catch {
    return false;
  }
}

async function assertAgentWeiboActionAvailable(options: AgentWeiboActionRuntimeOptions) {
  if (!(await agentWeiboActionAvailable(options))) {
    throw actionError('AIY_AGENT_ACTION_UNAVAILABLE', 'The Weibo channel extension is unavailable or invalid');
  }
}

function resolvedAssetFile(output: JobOutput): ResolvedAssetFile {
  const extension = extensionByMimeType[output.mimeType];
  return {
    ...output,
    suggestedName: `AIY-${output.objectHash.slice(0, 12)}${extension}`,
    extension,
  };
}

async function createRuntime(workspace: AgentCliWorkspace, outputs: readonly JobOutput[]) {
  const dataPath = workspace.browserCompanionDataPath;
  const credentials = await readBrowserCompanionCredentials(dataPath);
  const browser = new BrowserCompanionBrowserController({
    dataPath,
    environment: process.env,
    platform: process.platform,
    prepareLaunchUrl: (target, destinationUrl) => {
      if (!credentials) throw new Error('AIY desktop companion service is unavailable');
      return createBrowserCompanionBridgeUrl(credentials, target, destinationUrl);
    },
  });
  const assets = new Map(outputs.map((output) => [output.assetId, resolvedAssetFile(output)]));
  return new BrowserCompanionRuntime(
    new BrowserCompanionHandoffStore(dataPath),
    browser,
    (assetId) => assets.get(assetId) ?? null,
    undefined,
    () => workspace.library.id,
  );
}

function completedOutputs(job: AgentJobResult): JobOutput[] {
  if (job.state !== 'SUCCEEDED') {
    throw actionError('AIY_AGENT_JOB_NOT_READY', `Generation job ${job.jobId} is ${job.state}`);
  }
  if (!job.runs.length) {
    throw actionError('AIY_AGENT_JOB_OUTPUT_UNAVAILABLE', 'Generation job has no runs');
  }
  return job.runs.map((run) => {
    if (run.status !== 'SUCCEEDED' || !run.output) {
      throw actionError('AIY_AGENT_JOB_OUTPUT_UNAVAILABLE', `Generation run ${run.runId} has no available output`);
    }
    return run.output;
  });
}

export async function runAgentWeiboAction({
  client,
  workspace,
  request,
  runtimeOptions,
}: {
  client: AgentCliWorkerClient;
  workspace: AgentCliWorkspace;
  request: AgentWeiboHandoffRequest;
  runtimeOptions: AgentWeiboActionRuntimeOptions;
}): Promise<AgentWeiboHandoffResult> {
  const receipts = new AgentWeiboActionReceiptStore(path.join(workspace.browserCompanionDataPath, 'agent-actions'));
  const reused = await receipts.load(request);
  if (reused) return reused;

  await assertAgentWeiboActionAvailable(runtimeOptions);

  const job = agentJobResultSchema.parse(
    await client.request('agent.job.get', [{ protocolVersion: AIY_AGENT_PROTOCOL_VERSION, jobId: request.jobId }]),
  );
  const outputs = completedOutputs(job);
  let staged;
  try {
    staged = await (
      await createRuntime(workspace, outputs)
    ).stage({
      target: 'weibo',
      source: { kind: 'creation-draft', id: job.draftId },
      contentKind: 'social-post-body',
      text: request.text,
      mediaAssetIds: outputs.map((output) => output.assetId),
    });
  } catch (reason) {
    throw actionError(
      'AIY_AGENT_HANDOFF_FAILED',
      reason instanceof Error ? reason.message : 'AIY could not stage the Weibo handoff',
    );
  }
  const result = agentWeiboHandoffResultSchema.parse({
    requestId: request.requestId,
    jobId: request.jobId,
    reused: false,
    ...staged,
  });
  return receipts.store(request, result);
}
