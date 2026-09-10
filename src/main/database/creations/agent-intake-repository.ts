import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertIntakeActive, intakeError, normalizeIntakePath, readIntakeSource } from '@/main/agent/intake-source';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { IntakeRepository } from '@/main/database/creations/intake-repository';
import type { PackRepository } from '@/main/database/packs/pack-repository';
import {
  agentIntakeImportRequestSchema,
  agentIntakeResultSchema,
  type AgentIntakeGetRequest,
  type AgentIntakeImportRequest,
  type AgentIntakeResult,
} from '@/shared/contracts/agent-intake';

const receiptSchema = z.object({ request_hash: z.string(), result_json: z.string() });

export class AgentIntakeRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly articles: ArticleRepository,
    private readonly intake: IntakeRepository,
    private readonly packs: PackRepository,
  ) {}

  private assertSpace(spaceId: string) {
    if (this.packs.getLocalSpace().id !== spaceId) {
      throw intakeError(
        'SPACE_CONFLICT',
        'Active space differs from the selected destination; select the destination again',
      );
    }
  }

  private receipt(requestId: string, requestHash?: string): AgentIntakeResult | null {
    const row: unknown = this.storage.db
      .prepare('SELECT request_hash, result_json FROM agent_intake_receipts WHERE request_id = ?')
      .get(requestId);
    if (!row) return null;
    const receipt = receiptSchema.parse(row);
    if (requestHash && receipt.request_hash !== requestHash) {
      throw intakeError('REQUEST_CONFLICT', 'Request id is already bound to different content or destination');
    }
    const result = agentIntakeResultSchema.parse(JSON.parse(receipt.result_json) as unknown);
    const entity =
      result.kind === 'ARTICLE'
        ? this.storage.db.prepare('SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL').get(result.entityId)
        : this.storage.db.prepare('SELECT 1 FROM materials WHERE id = ? AND deleted_at IS NULL').get(result.entityId);
    if (!entity) throw intakeError('RESULT_UNAVAILABLE', 'Previously imported content is no longer available');
    return { ...result, reused: true };
  }

  get(request: AgentIntakeGetRequest) {
    this.assertSpace(request.spaceId);
    const result = this.receipt(request.requestId);
    if (!result) throw intakeError('NOT_FOUND', 'No committed import exists for this request');
    return result;
  }

  async import(rawRequest: AgentIntakeImportRequest, signal: AbortSignal): Promise<AgentIntakeResult> {
    const request = agentIntakeImportRequestSchema.parse({ ...rawRequest, path: normalizeIntakePath(rawRequest.path) });
    this.assertSpace(request.spaceId);
    const requestJson = JSON.stringify(request);
    const requestHash = createHash('sha256').update(requestJson).digest('hex');
    const existing = this.receipt(request.requestId, requestHash);
    if (existing) return existing;
    const source = await readIntakeSource(request, signal);
    const stored = source.kind === 'IMAGE_MATERIAL' ? await this.storage.storeBufferAsync(source.bytes, '.png') : null;
    assertIntakeActive(signal);

    return this.storage.db
      .transaction(() => {
        this.assertSpace(request.spaceId);
        const raced = this.receipt(request.requestId, requestHash);
        if (raced) return raced;
        let entityId: string;
        let revisionId: string | null = null;
        if (source.kind === 'ARTICLE') {
          const article = this.articles.save({
            id: null,
            albumId: null,
            sourceInspirationStashId: null,
            consumeCreationDraftId: null,
            content: source.content,
          });
          entityId = article.id;
          revisionId = article.revisionId;
        } else {
          const result = this.intake.commitStaged(
            {
              intent: 'IMPORT',
              source: 'UPLOAD',
              favorite: false,
              items: [
                {
                  id: 'image',
                  kind: 'IMAGE',
                  name: source.title,
                  mimeType: 'image/png',
                  bytes: source.bytes,
                  width: source.dimensions.width,
                  height: source.dimensions.height,
                },
              ],
            },
            new Map([['image', { stored: stored!, mimeType: 'image/png' }]]),
          );
          entityId = result.materialIds[0];
        }
        const target = source.kind === 'ARTICLE' ? 'article' : 'material';
        const result = agentIntakeResultSchema.parse({
          requestId: request.requestId,
          spaceId: request.spaceId,
          kind: request.kind,
          entityId,
          revisionId,
          title: source.title,
          sourceSha256: request.expectedSha256,
          reused: false,
          status: 'COMMITTED',
          openUrl: `aiy://open/space/${request.spaceId}/${target}/${entityId}`,
        });
        this.storage.db
          .prepare(
            `INSERT INTO agent_intake_receipts
        (request_id, request_hash, request_json, result_json, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(request.requestId, requestHash, requestJson, JSON.stringify(result), now());
        return result;
      })
      .immediate();
  }
}
