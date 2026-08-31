import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  agentWeiboHandoffRequestSchema,
  agentWeiboHandoffResultSchema,
  type AgentWeiboHandoffRequest,
  type AgentWeiboHandoffResult,
} from '@/shared/contracts/agent-cli';

const MAX_RECEIPT_BYTES = 128 * 1024;
const inputHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: agentWeiboHandoffRequestSchema.shape.requestId,
    inputHash: inputHashSchema,
    result: agentWeiboHandoffResultSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

function receiptError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function hasErrorCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

function inputHash(request: AgentWeiboHandoffRequest) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocolVersion: request.protocolVersion,
        jobId: request.jobId,
        text: request.text,
      }),
    )
    .digest('hex');
}

export class AgentWeiboActionReceiptStore {
  constructor(private readonly directoryPath: string) {}

  private receiptPath(requestId: string) {
    const name = createHash('sha256').update(requestId).digest('hex');
    return path.join(this.directoryPath, `${name}.json`);
  }

  async load(request: AgentWeiboHandoffRequest): Promise<AgentWeiboHandoffResult | null> {
    const filePath = this.receiptPath(request.requestId);
    let metadata;
    try {
      metadata = await lstat(filePath);
    } catch (reason) {
      if (hasErrorCode(reason, 'ENOENT')) return null;
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY could not read the command action receipt');
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_RECEIPT_BYTES) {
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY command action receipt is invalid');
    }

    let value: unknown;
    try {
      value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch {
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY command action receipt contains malformed JSON');
    }
    const parsed = receiptSchema.safeParse(value);
    if (!parsed.success || parsed.data.requestId !== request.requestId) {
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY command action receipt does not match its schema');
    }
    if (parsed.data.inputHash !== inputHash(request)) {
      throw receiptError('AIY_AGENT_REQUEST_CONFLICT', 'The requestId is already bound to different action input');
    }
    return agentWeiboHandoffResultSchema.parse({ ...parsed.data.result, reused: true });
  }

  async store(request: AgentWeiboHandoffRequest, result: AgentWeiboHandoffResult): Promise<AgentWeiboHandoffResult> {
    await mkdir(this.directoryPath, { recursive: true });
    const record = receiptSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      inputHash: inputHash(request),
      result,
      createdAt: new Date().toISOString(),
    });
    const bytes = Buffer.from(JSON.stringify(record), 'utf8');
    if (bytes.byteLength > MAX_RECEIPT_BYTES) {
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY command action receipt exceeds its size limit');
    }
    try {
      await writeFile(this.receiptPath(request.requestId), bytes, { flag: 'wx', mode: 0o600 });
      return result;
    } catch (reason) {
      if (!hasErrorCode(reason, 'EEXIST')) {
        throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY could not persist the command action receipt');
      }
      const existing = await this.load(request);
      if (existing) return existing;
      throw receiptError('AIY_AGENT_ACTION_STATE_INVALID', 'AIY command action receipt is unavailable');
    }
  }
}
