import { ulid } from 'ulid';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import type { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import {
  contentReferenceSchema,
  type ContentReference,
  type ResolvedContentReference,
} from '@/shared/contracts/content-library';
import type { ReferenceTarget } from '@/shared/contracts/content-source';
import { contentMarkdownReferences } from '@/shared/content-markdown';

/** One-way saved-source following. The cached body is an observation, never an editing authority. */
export class ContentFollowingReferences {
  constructor(
    private readonly repositories: LibraryDatabaseRepositories,
    private readonly content: ContentLibraryRepository,
    private readonly targets: ContentReferenceTargets,
  ) {}
  private get db() {
    return this.repositories.db;
  }
  private spaceId() {
    return String(this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get());
  }
  private inspect(target: ReferenceTarget) {
    if (target.source.kind !== 'ARTICLE' || target.source.revisionId || target.source.branchId || target.source.noteId)
      throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
    this.targets.open(target);
    const preview = this.targets.inspect(target);
    // Nested following is explicitly bounded out. This also detects self/indirect cycles
    // introduced by later edits, without traversing an unbounded dependency graph.
    const ids = [...new Set(contentMarkdownReferences(preview.markdown).map(({ id }) => id))];
    if (ids.length > 100) throw new Error('Too many block references');
    if (
      ids.length &&
      this.db
        .prepare(
          `SELECT 1 FROM content_following_references WHERE reference_id IN (${ids.map(() => '?').join(',')}) LIMIT 1`,
        )
        .get(...ids)
    )
      throw new Error('REFERENCE_FOLLOW_NESTED');
    return preview;
  }
  follow(target: ReferenceTarget, expectedVersion: string) {
    return this.db.transaction(() => {
      const preview = this.inspect(target);
      if (preview.version !== expectedVersion) throw new Error('REFERENCE_TARGET_CHANGED');
      const reference = this.targets.snapshot(preview);
      this.content.storeReference(reference);
      this.db
        .prepare(
          'INSERT INTO content_following_references(reference_id,space_id,snapshot_json,updated_at) VALUES (?,?,?,?)',
        )
        .run(reference.id, this.spaceId(), JSON.stringify(reference), reference.createdAt);
      return reference;
    })();
  }
  resolve(ids: string[]): ResolvedContentReference[] {
    return this.db.transaction(() =>
      this.content.references(ids).map((reference): ResolvedContentReference => {
        const row = this.db
          .prepare('SELECT space_id,snapshot_json FROM content_following_references WHERE reference_id=?')
          .get(reference.id) as { space_id: string; snapshot_json: string } | undefined;
        if (!row) return { reference, mode: 'FIXED', state: 'CURRENT' };
        const cached = contentReferenceSchema.parse(JSON.parse(row.snapshot_json));
        try {
          if (row.space_id !== this.spaceId()) throw new Error('REFERENCE_FOLLOW_SPACE_CHANGED');
          if (reference.selector?.kind !== 'BLOCK' && reference.selector?.kind !== 'DOCUMENT_BODY')
            throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
          const target: ReferenceTarget = {
            source: { kind: 'ARTICLE', id: reference.source.id },
            ...(reference.selector.kind === 'BLOCK'
              ? {
                  blockId: reference.selector.blockId,
                  section: reference.selector.section,
                  scope: reference.selector.scope,
                }
              : {}),
          };
          const preview = this.inspect(target);
          if (preview.revisionId === cached.revisionId)
            return { reference: cached, captured: reference, mode: 'FOLLOW', state: 'CURRENT' };
          const current = this.targets.snapshot(preview, reference.id);
          this.db
            .prepare('UPDATE content_following_references SET snapshot_json=?,updated_at=? WHERE reference_id=?')
            .run(JSON.stringify(current), current.createdAt, reference.id);
          // Preserve media in both the original fixed capture and the last readable cache.
          this.db.prepare('DELETE FROM content_block_assets WHERE reference_id=?').run(reference.id);
          const retain = this.db.prepare('INSERT INTO content_block_assets(reference_id,asset_id) VALUES (?,?)');
          for (const assetId of new Set([...reference.media, ...current.media].map(({ assetId }) => assetId)))
            retain.run(reference.id, assetId);
          return { reference: current, captured: reference, mode: 'FOLLOW', state: 'CURRENT' };
        } catch (reason) {
          const code = reason instanceof Error ? reason.message : '';
          if (
            !/^(REFERENCE_(SOURCE_UNAVAILABLE|LOCATION_MISSING|FOLLOW_SPACE_CHANGED|FOLLOW_SCOPE_UNSUPPORTED|FOLLOW_NESTED)|BLOCK_(ID_UNAVAILABLE|ID_AMBIGUOUS|SCOPE_UNSUPPORTED))$/.test(
              code,
            )
          )
            throw reason;
          return { reference: cached, captured: reference, mode: 'FOLLOW', state: 'UNAVAILABLE', reason: code };
        }
      }),
    )();
  }
  freeze(id: string, expectedRevisionId: string, expectedContentHash: string): ContentReference {
    return this.db.transaction(() => {
      const resolved = this.resolve([id])[0];
      if (
        !resolved ||
        resolved.reference.revisionId !== expectedRevisionId ||
        resolved.reference.contentHash !== expectedContentHash
      )
        throw new Error('REFERENCE_TARGET_CHANGED');
      // An invalid source can only become a fixed copy through this explicit, version-checked action.
      const reference = { ...resolved.reference, id: ulid(), createdAt: new Date().toISOString() };
      this.content.storeReference(reference);
      return reference;
    })();
  }
}
