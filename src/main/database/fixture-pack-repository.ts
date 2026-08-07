import type { LibraryStorage } from '@/main/database/storage';
import type { PackRepository, PackReleaseItemInput } from '@/main/database/pack-repository';
import type { FixturePackProfile } from '@/main/database/fixture-pack-profile';
import {
  fixtureContentHash,
  fixtureTermSourceHash,
  type FixturePackSource,
  type FixturePackSourcePaths,
  readFixturePackSource,
} from '@/main/database/fixture-pack-source';
import { type JsonMap, text } from '@/main/database/values';

interface FixtureLocalMapping {
  itemKey: string;
  localObjectType: 'TERM' | 'RECIPE';
  localObjectId: string;
  localRevisionId: string;
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${fixtureContentHash(value).slice(0, 32)}`;
}

function termRevisionContentHash(db: LibraryStorage['db'], stableKey: string, revisionId: string) {
  const row = db
    .prepare(
      `SELECT revision.title, revision.title_locale, revision.definition,
      primary_category.stable_key AS primary_directory_classification_key
    FROM term_revisions revision
    JOIN terms term ON term.id = revision.term_id
    LEFT JOIN term_directory_placements placement ON placement.term_id = term.id
    LEFT JOIN term_categories primary_category ON primary_category.id = placement.primary_category_id
    WHERE revision.id = ? AND term.stable_key = ?`,
    )
    .get(revisionId, stableKey) as JsonMap | undefined;
  if (!row) return '';
  const aliases = db
    .prepare(
      `SELECT locale, value FROM term_aliases
    WHERE term_revision_id = ? ORDER BY locale, normalized_value, value`,
    )
    .all(revisionId) as JsonMap[];
  const expressions = db
    .prepare(
      `SELECT profile.stable_key AS context_key, expression.model_key, expression.locale,
        expression.positive_expression, expression.negative_expression
      FROM term_expressions expression
      JOIN term_context_profile_revisions profile_revision
        ON profile_revision.id = expression.context_profile_revision_id
      JOIN term_context_profiles profile ON profile.id = profile_revision.context_profile_id
      WHERE expression.term_revision_id = ?
      ORDER BY profile.stable_key, expression.model_key, expression.locale, expression.id`,
    )
    .all(revisionId) as JsonMap[];
  const localizations = db
    .prepare(
      `SELECT locale, title, definition FROM term_localizations
    WHERE term_revision_id = ? ORDER BY locale`,
    )
    .all(revisionId) as JsonMap[];
  const classifications = db
    .prepare(
      `SELECT category.stable_key
      FROM term_revision_categories membership
      JOIN term_categories category ON category.id = membership.category_id
      WHERE membership.term_revision_id = ?
      ORDER BY membership.sort_order, membership.category_id`,
    )
    .all(revisionId) as JsonMap[];
  const valuesFor = (locale: string) =>
    aliases
      .filter((alias) => text(alias.locale) === locale)
      .map((alias) => text(alias.value).trim())
      .filter(Boolean)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return fixtureTermSourceHash({
    stableKey,
    title: text(row.title).trim(),
    titleLocale: text(row.title_locale),
    definition: text(row.definition).trim(),
    aliases: valuesFor(text(row.title_locale)),
    localizations: localizations.map((item) => ({
      locale: text(item.locale),
      title: text(item.title).trim(),
      definition: text(item.definition).trim(),
      aliases: valuesFor(text(item.locale)),
    })),
    classificationKeys: classifications.map((classification) => text(classification.stable_key)),
    primaryDirectoryClassificationKey: text(row.primary_directory_classification_key),
    expressions: expressions.map((item) => ({
      contextKey: text(item.context_key),
      modelKey: text(item.model_key),
      locale: text(item.locale),
      positive: text(item.positive_expression).trim(),
      negative: text(item.negative_expression).trim(),
    })),
  });
}

export class FixturePackRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly packs: PackRepository,
  ) {}

  prepare(profile: FixturePackProfile, sourcePaths: FixturePackSourcePaths) {
    return readFixturePackSource(profile, sourcePaths);
  }

  isCurrent(source: FixturePackSource) {
    const expectedItemCount = source.terms.length + source.recipes.length;
    const state = this.storage.db
      .prepare(
        `SELECT pack.kind, pack.display_name, pack.description,
        pack.content_kinds_json, release.version, release.content_hash,
        installation.selected_release_id, installation.state, installation.deleted_at
      FROM packs pack
      JOIN pack_releases release ON release.pack_id = pack.id
      JOIN pack_installations installation ON installation.pack_id = pack.id
      WHERE pack.id = ? AND release.id = ? AND release.sealed_at IS NOT NULL
      ORDER BY installation.created_at DESC, installation.id DESC LIMIT 1`,
      )
      .get(source.profile.id, source.releaseId) as JsonMap | undefined;
    if (
      !state ||
      text(state.kind) !== 'CONTENT' ||
      text(state.display_name) !== source.profile.displayName ||
      text(state.description) !== source.profile.description ||
      text(state.content_kinds_json) !== JSON.stringify(source.profile.contentKinds) ||
      text(state.version) !== source.releaseVersion ||
      text(state.content_hash) !== `sha256:${source.sourceDigest}` ||
      text(state.selected_release_id) !== source.releaseId ||
      !['INSTALLED', 'DISABLED'].includes(text(state.state)) ||
      state.deleted_at !== null
    )
      return false;

    const itemCount = Number(
      this.storage.db
        .prepare(
          `SELECT count(*) FROM pack_release_items
      WHERE release_id = ?`,
        )
        .pluck()
        .get(source.releaseId),
    );
    if (itemCount !== expectedItemCount) return false;
    const linkedItemCount = Number(
      this.storage.db
        .prepare(
          `SELECT count(DISTINCT item.id)
      FROM pack_release_items item
      JOIN pack_object_links link ON link.release_item_id = item.id AND link.deleted_at IS NULL
      WHERE item.release_id = ?`,
        )
        .pluck()
        .get(source.releaseId),
    );
    return linkedItemCount === expectedItemCount;
  }

  ensure(source: FixturePackSource) {
    const { profile } = source;
    return this.storage.db.transaction(() => {
      const mappings: FixtureLocalMapping[] = [];
      const items: PackReleaseItemInput[] = [];

      for (const term of source.terms) {
        const local = this.storage.db
          .prepare('SELECT id FROM terms WHERE id = ? AND stable_key = ?')
          .get(term.localObjectId, term.stableKey) as JsonMap | undefined;
        if (!local) throw new Error(`Content package term was not materialized: ${term.stableKey}`);
        const localRevisionId = [term.derivedLocalRevisionId, term.baseLocalRevisionId].find(
          (revisionId) =>
            termRevisionContentHash(this.storage.db, term.stableKey, revisionId) ===
            term.contentHash.replace(/^sha256:/, ''),
        );
        if (!localRevisionId) {
          throw new Error(`Content package term revision does not match its source: ${term.stableKey}`);
        }
        items.push({
          itemKey: term.itemKey,
          objectType: 'TERM_REVISION',
          objectRevisionId: term.packageRevisionId,
          contentHash: term.contentHash,
          metadata: { stableKey: term.stableKey },
          provenance: { source: 'CONTENT_PACKAGE', packageKey: profile.key },
        });
        mappings.push({
          itemKey: term.itemKey,
          localObjectType: 'TERM',
          localObjectId: term.localObjectId,
          localRevisionId,
        });
      }

      for (const recipe of source.recipes) {
        const local = this.storage.db
          .prepare(
            `SELECT palette.id AS palette_id, revision.id AS revision_id
          FROM word_palettes palette
          JOIN word_palette_revisions revision ON revision.palette_id = palette.id
          WHERE palette.id = ? AND revision.content_hash = ?
          ORDER BY revision.revision_no, revision.id LIMIT 1`,
          )
          .get(recipe.localObjectId, recipe.localContentHash) as JsonMap | undefined;
        if (!local) throw new Error(`Content package recipe was not materialized: ${recipe.stableKey}`);
        items.push({
          itemKey: recipe.itemKey,
          objectType: 'RECIPE_REVISION',
          objectRevisionId: recipe.packageRevisionId,
          contentHash: recipe.contentHash,
          metadata: { stableKey: recipe.stableKey },
          provenance: { source: 'CONTENT_PACKAGE', packageKey: profile.key },
        });
        mappings.push({
          itemKey: recipe.itemKey,
          localObjectType: 'RECIPE',
          localObjectId: text(local.palette_id),
          localRevisionId: text(local.revision_id),
        });
      }

      const pack = this.packs.registerPack({
        id: profile.id,
        kind: 'CONTENT',
        displayName: profile.displayName,
        description: profile.description,
        contentKinds: profile.contentKinds,
      });
      const release = this.packs.registerPackRelease({
        id: source.releaseId,
        packId: profile.id,
        version: source.releaseVersion,
        manifestVersion: 1,
        contentHash: `sha256:${source.sourceDigest}`,
        manifest: {
          kind: 'CONTENT_PACKAGE',
          contract: 'CONTENT_PACKAGE_V1',
          packageKey: profile.key,
          sourceLibraryId: profile.fixtureLibraryId,
          sourceDigest: source.sourceDigest,
          dictionaryRevision: source.dictionaryRevision,
          paletteRevision: source.paletteRevision,
          termRevisionCount: source.terms.length,
          recipeRevisionCount: source.recipes.length,
        },
        compatibility: { productBaseline: '0.3.0' },
        defaultRoles: profile.defaultRoles,
        provenance: {
          source: 'CONTENT_PACKAGE',
          packageKey: profile.key,
          sourceLibraryId: profile.fixtureLibraryId,
          sourceDigest: source.sourceDigest,
        },
        items,
      });
      const installation = this.packs.installExactPackRelease({
        packId: pack.id,
        releaseId: release.id,
        source: { source: 'CONTENT_PACKAGE', packageKey: profile.key },
        verification: { contentHash: release.contentHash, itemCount: release.items.length },
      });
      const releaseItems = new Map(release.items.map((item) => [item.itemKey, item]));
      for (const mapping of mappings) {
        const item = releaseItems.get(mapping.itemKey);
        if (!item) throw new Error(`Content package release item is missing: ${mapping.itemKey}`);
        this.packs.linkPackReleaseItem({
          id: deterministicId('pack_link', {
            spaceId: installation.spaceId,
            releaseItemId: item.id,
            localRevisionId: mapping.localRevisionId,
          }),
          releaseItemId: item.id,
          localObjectType: mapping.localObjectType,
          localObjectId: mapping.localObjectId,
          localRevisionId: mapping.localRevisionId,
          mappingKind: 'REUSED_IDENTICAL',
        });
      }
      return { pack, release, installation };
    })();
  }
}
