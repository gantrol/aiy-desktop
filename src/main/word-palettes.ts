import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ulid } from 'ulid';
import type {
  CreateWordPaletteInput,
  AssetDto,
  Locale,
  TermListItem,
  UpdateWordPaletteInput,
  WordPaletteContentDto,
  WordPaletteContentInput,
  WordPaletteDto,
  WordPaletteParameterDto,
  WordPaletteParameterInput,
  WordPalettePromptNodeDto,
  WordPalettePromptNodeInput,
  WordPaletteRevisionDto,
} from '@/shared/contracts';
import { mediaUrl } from '@/main/database/values';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';

type JsonMap = Record<string, unknown>;
type TermReader = (termId: string, locale: Locale) => TermListItem;

interface NormalizedPalette {
  name: string;
  nameLocale: string;
  description: string;
  localizations: Array<{ locale: string; name: string; description: string }>;
  termIds: string[];
  referenceAssetIds: string[];
  parameters: WordPaletteParameterInput[];
  promptNodes: WordPalettePromptNodeInput[];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const maps = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is JsonMap => Boolean(item) && typeof item === 'object') : [];
const jsonMaps = (value: unknown) => {
  try {
    return maps(JSON.parse(text(value)));
  } catch {
    return [];
  }
};
const catalogSuffix = (stableKey: string) =>
  trimSurroundingCharacters(stableKey.toLowerCase().replace(/[^a-z0-9]+/g, '_'), '_');

function paletteKind(input: NormalizedPalette) {
  return input.parameters.length ? ('PARAMETERIZED' as const) : ('STATIC' as const);
}

function paletteContentHash(input: NormalizedPalette) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: input.name,
        nameLocale: input.nameLocale,
        description: input.description,
        localizations: input.localizations,
        termIds: input.termIds,
        referenceAssetIds: input.referenceAssetIds,
        parameters: input.parameters,
        promptNodes: input.promptNodes,
      }),
    )
    .digest('hex');
}

function createPaletteRevision(db: Database.Database, paletteId: string, input: NormalizedPalette, timestamp: string) {
  const current = db
    .prepare(
      `SELECT r.id, r.revision_no, r.content_hash
    FROM word_palettes p LEFT JOIN word_palette_revisions r ON r.id = p.current_revision_id
    WHERE p.id = ?`,
    )
    .get(paletteId) as JsonMap | undefined;
  if (!current) throw new Error('Word palette not found');
  const contentHash = paletteContentHash(input);
  if (text(current.content_hash) === contentHash) {
    return { revisionId: text(current.id), revisionNo: Number(current.revision_no), created: false };
  }

  const revisionId = ulid();
  const revisionNo = current.id ? Number(current.revision_no) + 1 : 1;
  db.prepare(
    `INSERT INTO word_palette_revisions
    (id, palette_id, parent_revision_id, revision_no, name, name_locale, description,
     kind, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    revisionId,
    paletteId,
    current.id ?? null,
    revisionNo,
    input.name,
    input.nameLocale,
    input.description,
    paletteKind(input),
    contentHash,
    timestamp,
  );
  for (const localization of input.localizations) {
    db.prepare(
      `INSERT INTO word_palette_revision_localizations
      (id, palette_revision_id, locale, name, description) VALUES (?, ?, ?, ?, ?)`,
    ).run(ulid(), revisionId, localization.locale, localization.name, localization.description);
  }
  for (const [termIndex, termId] of input.termIds.entries()) {
    db.prepare(
      `INSERT INTO word_palette_revision_terms
      (id, palette_revision_id, term_id, sort_order) VALUES (?, ?, ?, ?)`,
    ).run(ulid(), revisionId, termId, termIndex);
  }
  for (const [mediaIndex, assetId] of input.referenceAssetIds.entries()) {
    db.prepare(
      `INSERT INTO word_palette_revision_media
      (id, palette_revision_id, image_asset_id, sort_order) VALUES (?, ?, ?, ?)`,
    ).run(ulid(), revisionId, assetId, mediaIndex);
  }
  const parameterIds = new Map<string, string>();
  for (const [parameterIndex, parameter] of input.parameters.entries()) {
    const parameterId = ulid();
    parameterIds.set(parameter.stableKey, parameterId);
    db.prepare(
      `INSERT INTO word_palette_revision_parameters
      (id, palette_revision_id, stable_key, name, name_locale, required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      parameterId,
      revisionId,
      parameter.stableKey,
      parameter.name,
      parameter.nameLocale,
      Number(parameter.required),
      parameterIndex,
    );
    for (const localization of parameter.localizations) {
      db.prepare(
        `INSERT INTO word_palette_revision_parameter_localizations
        (id, parameter_revision_id, locale, name) VALUES (?, ?, ?, ?)`,
      ).run(ulid(), parameterId, localization.locale, localization.name);
    }
    for (const [optionIndex, option] of parameter.options.entries()) {
      const optionId = ulid();
      db.prepare(
        `INSERT INTO word_palette_revision_parameter_options
        (id, parameter_revision_id, value_key, label, label_locale, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(optionId, parameterId, option.value, option.label, option.labelLocale, optionIndex);
      for (const localization of option.localizations) {
        db.prepare(
          `INSERT INTO word_palette_revision_option_localizations
          (id, option_id, locale, label) VALUES (?, ?, ?, ?)`,
        ).run(ulid(), optionId, localization.locale, localization.label);
      }
      for (const [contentIndex, content] of option.contents.entries()) {
        db.prepare(
          `INSERT INTO word_palette_revision_option_contents
          (id, option_id, kind, term_id, prompt_fragment, negative_fragment, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          ulid(),
          optionId,
          content.kind,
          content.kind === 'TERM' ? content.termId : null,
          content.kind === 'TEXT' ? content.promptFragment : '',
          content.kind === 'TEXT' ? content.negativeFragment : '',
          contentIndex,
        );
      }
    }
  }
  for (const [nodeIndex, node] of input.promptNodes.entries()) {
    const parameterId = node.kind === 'SLOT' ? parameterIds.get(node.stableKey) : undefined;
    if (node.kind === 'SLOT' && !parameterId) throw new Error(`Unknown palette variation: ${node.stableKey}`);
    db.prepare(
      `INSERT INTO word_palette_revision_content_nodes
      (id, palette_revision_id, kind, term_id, parameter_revision_id,
       prompt_fragment, negative_fragment, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(),
      revisionId,
      node.kind,
      node.kind === 'TERM' ? node.termId : null,
      node.kind === 'SLOT' ? parameterId : null,
      node.kind === 'TEXT' ? node.promptFragment : '',
      node.kind === 'TEXT' ? node.negativeFragment : '',
      nodeIndex,
    );
  }
  db.prepare('UPDATE word_palettes SET current_revision_id = ?, updated_at = ? WHERE id = ?').run(
    revisionId,
    timestamp,
    paletteId,
  );
  return { revisionId, revisionNo, created: true };
}

function normalizedCatalogPalette(db: Database.Database, palette: JsonMap): NormalizedPalette {
  const termId = (stableKeyValue: unknown) => {
    const stableKey = text(stableKeyValue).trim();
    if (!stableKey) throw new Error('Word palette source term key is required');
    const term = db.prepare('SELECT id FROM terms WHERE stable_key = ? AND archived_at IS NULL').get(stableKey) as
      JsonMap | undefined;
    if (!term) throw new Error(`Unknown word palette source term: ${stableKey}`);
    return text(term.id);
  };
  const sourceContents = (value: unknown): WordPaletteContentInput[] =>
    maps(value).map((content) => {
      const kind = text(content.kind);
      if (kind === 'TERM') return { kind: 'TERM' as const, termId: termId(content.termStableKey) };
      if (kind === 'TEXT') {
        return {
          kind: 'TEXT' as const,
          promptFragment: text(content.promptFragment),
          negativeFragment: text(content.negativeFragment),
        };
      }
      throw new Error(`Unknown word palette content kind: ${kind}`);
    });
  const parameters = maps(palette.parameters).map((parameter): WordPaletteParameterInput => {
    const stableKey = text(parameter.stableKey).trim();
    if (!stableKey) throw new Error('Word palette parameter key is required');
    const options = maps(parameter.options).map((option) => {
      const value = text(option.value).trim();
      if (!value) throw new Error(`Word palette option value is required: ${stableKey}`);
      return {
        value,
        label: text(option.label).trim() || value,
        labelLocale: text(option.labelLocale).trim(),
        localizations: maps(option.localizations).map((localization) => ({
          locale: text(localization.locale),
          label: text(localization.label),
        })),
        contents: sourceContents(option.contents),
      };
    });
    if (!options.length) throw new Error(`Word palette parameter options are required: ${stableKey}`);
    return {
      stableKey,
      name: text(parameter.name).trim(),
      nameLocale: text(parameter.nameLocale).trim(),
      localizations: maps(parameter.localizations).map((localization) => ({
        locale: text(localization.locale),
        name: text(localization.name),
      })),
      required: Boolean(parameter.required),
      options,
    };
  });
  const promptNodes = maps(palette.promptNodes).map((node): WordPalettePromptNodeInput => {
    if (node.kind === 'SLOT') return { kind: 'SLOT', stableKey: text(node.stableKey) };
    return sourceContents([node])[0];
  });
  return validateWordPaletteInput(db, {
    locale: 'en',
    name: text(palette.name).trim(),
    nameLocale: text(palette.nameLocale).trim(),
    description: text(palette.description).trim(),
    localizations: maps(palette.localizations).map((localization) => ({
      locale: text(localization.locale),
      name: text(localization.name),
      description: text(localization.description),
    })),
    referenceAssetIds: [],
    parameters,
    promptNodes,
  });
}

export function reconcileWordPaletteCatalog(
  db: Database.Database,
  sourcePath: string,
  revisionMarkerKey = 'word_palette_catalog_revision',
  sourceDocument?: JsonMap,
) {
  const source = sourceDocument ?? (JSON.parse(readFileSync(sourcePath, 'utf8')) as JsonMap);
  const revision = text(source.revision);
  const palettes = maps(source.palettes);
  if (!revision || !palettes.length) return;
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(revisionMarkerKey) as
    { value: string } | undefined;
  if (marker?.value === revision) return;
  const reconciledAt = Date.now();

  db.transaction(() => {
    for (const [paletteIndex, palette] of palettes.entries()) {
      const stableKey = text(palette.stableKey);
      if (!stableKey) throw new Error('Word palette source stable key is required');
      const paletteId = `palette_catalog_${catalogSuffix(stableKey)}`;
      const existing = db.prepare('SELECT deleted_at FROM word_palettes WHERE id = ?').get(paletteId) as
        JsonMap | undefined;
      if (existing?.deleted_at) continue;
      const normalized = normalizedCatalogPalette(db, palette);
      const timestamp = new Date(reconciledAt - paletteIndex * 1000).toISOString();
      if (!existing) {
        db.prepare(
          `INSERT INTO word_palettes
          (id, pinned, created_at, updated_at, archived_at, deleted_at, current_revision_id)
          VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
        ).run(paletteId, Number(Boolean(palette.pinned)), timestamp, timestamp);
      } else {
        db.prepare('UPDATE word_palettes SET pinned = ? WHERE id = ?').run(Number(Boolean(palette.pinned)), paletteId);
      }
      createPaletteRevision(db, paletteId, normalized, timestamp);
    }
    db.prepare('INSERT OR REPLACE INTO app_meta(key, value) VALUES (?, ?)').run(revisionMarkerKey, revision);
  })();
}

interface PaletteReadDetails {
  termsByRevision: Map<string, JsonMap[]>;
  parametersByRevision: Map<string, JsonMap[]>;
  mediaByRevision: Map<string, JsonMap[]>;
  promptNodesByRevision: Map<string, JsonMap[]>;
  optionsByParameter: Map<string, JsonMap[]>;
  contentsByOption: Map<string, JsonMap[]>;
}

function groupRows(rows: JsonMap[], key: string) {
  const groups = new Map<string, JsonMap[]>();
  for (const row of rows) {
    const value = text(row[key]);
    if (!value) continue;
    const group = groups.get(value);
    if (group) group.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

function loadPaletteReadDetails(db: Database.Database, paletteIds: string[]): PaletteReadDetails {
  if (!paletteIds.length) {
    return {
      termsByRevision: new Map(),
      parametersByRevision: new Map(),
      mediaByRevision: new Map(),
      promptNodesByRevision: new Map(),
      optionsByParameter: new Map(),
      contentsByOption: new Map(),
    };
  }
  const placeholders = paletteIds.map(() => '?').join(', ');
  const termRows = db
    .prepare(
      `SELECT term.* FROM word_palette_revision_terms term
    JOIN word_palette_revisions revision ON revision.id = term.palette_revision_id
    WHERE revision.palette_id IN (${placeholders})
    ORDER BY term.palette_revision_id, term.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  const parameterRows = db
    .prepare(
      `SELECT parameter.*,
      COALESCE((
        SELECT json_group_array(json_object('locale', localization.locale, 'name', localization.name))
        FROM (
          SELECT locale, name FROM word_palette_revision_parameter_localizations
          WHERE parameter_revision_id = parameter.id ORDER BY locale
        ) localization
      ), '[]') AS localizations_json
    FROM word_palette_revision_parameters parameter
    JOIN word_palette_revisions revision ON revision.id = parameter.palette_revision_id
    WHERE revision.palette_id IN (${placeholders})
    ORDER BY parameter.palette_revision_id, parameter.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  const mediaRows = db
    .prepare(
      `SELECT media.palette_revision_id, asset.*
    FROM word_palette_revision_media media
    JOIN word_palette_revisions revision ON revision.id = media.palette_revision_id
    JOIN image_assets asset ON asset.id = media.image_asset_id
    WHERE revision.palette_id IN (${placeholders}) AND asset.deleted_at IS NULL
    ORDER BY media.palette_revision_id, media.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  const promptNodeRows = db
    .prepare(
      `SELECT node.*, parameter.stable_key
    FROM word_palette_revision_content_nodes node
    JOIN word_palette_revisions revision ON revision.id = node.palette_revision_id
    LEFT JOIN word_palette_revision_parameters parameter ON parameter.id = node.parameter_revision_id
    WHERE revision.palette_id IN (${placeholders})
    ORDER BY node.palette_revision_id, node.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  const optionRows = db
    .prepare(
      `SELECT option.*,
      COALESCE((
        SELECT json_group_array(json_object('locale', localization.locale, 'label', localization.label))
        FROM (
          SELECT locale, label FROM word_palette_revision_option_localizations
          WHERE option_id = option.id ORDER BY locale
        ) localization
      ), '[]') AS localizations_json

    FROM word_palette_revision_parameter_options option
    JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
    JOIN word_palette_revisions revision ON revision.id = parameter.palette_revision_id
    WHERE revision.palette_id IN (${placeholders})
    ORDER BY option.parameter_revision_id, option.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  const contentRows = db
    .prepare(
      `SELECT content.*
    FROM word_palette_revision_option_contents content
    JOIN word_palette_revision_parameter_options option ON option.id = content.option_id
    JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
    JOIN word_palette_revisions revision ON revision.id = parameter.palette_revision_id
    WHERE revision.palette_id IN (${placeholders})
    ORDER BY content.option_id, content.sort_order`,
    )
    .all(...paletteIds) as JsonMap[];
  return {
    termsByRevision: groupRows(termRows, 'palette_revision_id'),
    parametersByRevision: groupRows(parameterRows, 'palette_revision_id'),
    mediaByRevision: groupRows(mediaRows, 'palette_revision_id'),
    promptNodesByRevision: groupRows(promptNodeRows, 'palette_revision_id'),
    optionsByParameter: groupRows(optionRows, 'parameter_revision_id'),
    contentsByOption: groupRows(contentRows, 'option_id'),
  };
}

function readPaletteRevision(
  row: JsonMap,
  locale: Locale,
  readTerm: TermReader,
  details: PaletteReadDetails,
): WordPaletteRevisionDto {
  const revisionId = text(row.id);
  const termRows = details.termsByRevision.get(revisionId) ?? [];
  const parameterRows = details.parametersByRevision.get(revisionId) ?? [];
  const mediaRows = details.mediaByRevision.get(revisionId) ?? [];
  const readContent = (content: JsonMap): WordPaletteContentDto =>
    content.kind === 'TERM'
      ? {
          id: text(content.id),
          kind: 'TERM',
          term: readTerm(text(content.term_id), locale),
        }
      : {
          id: text(content.id),
          kind: 'TEXT',
          promptFragment: text(content.prompt_fragment),
          negativeFragment: text(content.negative_fragment),
        };
  const parameters: WordPaletteParameterDto[] = parameterRows.map((parameter) => ({
    id: text(parameter.id),
    stableKey: text(parameter.stable_key),
    name: text(parameter.name),
    nameLocale: text(parameter.name_locale),
    localizations: jsonMaps(parameter.localizations_json).map((localization) => ({
      locale: text(localization.locale),
      name: text(localization.name),
    })),
    required: Boolean(parameter.required),
    options: (details.optionsByParameter.get(text(parameter.id)) ?? []).map((option) => {
      const contents = details.contentsByOption.get(text(option.id)) ?? [];
      return {
        id: text(option.id),
        value: text(option.value_key),
        label: text(option.label) || text(option.value_key),
        labelLocale: text(option.label_locale),
        localizations: jsonMaps(option.localizations_json).map((localization) => ({
          locale: text(localization.locale),
          label: text(localization.label),
        })),
        contents: contents.map(readContent),
      };
    }),
  }));
  const promptNodeRows = details.promptNodesByRevision.get(revisionId) ?? [];
  const promptNodes: WordPalettePromptNodeDto[] = promptNodeRows.map((node) =>
    node.kind === 'SLOT' ? { id: text(node.id), kind: 'SLOT', stableKey: text(node.stable_key) } : readContent(node),
  );
  return {
    id: revisionId,
    revisionNo: Number(row.revision_no),
    name: text(row.name),
    nameLocale: text(row.name_locale),
    description: text(row.description),
    localizations: jsonMaps(row.localizations_json).map((localization) => ({
      locale: text(localization.locale),
      name: text(localization.name),
      description: text(localization.description),
    })),
    kind: text(row.kind) as WordPaletteRevisionDto['kind'],
    terms: termRows.map((item) => readTerm(text(item.term_id), locale)),
    parameters,
    promptNodes,
    referenceAssets: mediaRows.map((asset): AssetDto => ({
      id: text(asset.id),
      kind: text(asset.kind) as AssetDto['kind'],
      originType: text(asset.origin_type),
      width: Number(asset.width),
      height: Number(asset.height),
      mimeType: text(asset.mime_type),
      byteSize: Number(asset.byte_size),
      mediaUrl: mediaUrl(text(asset.id)),
      createdAt: text(asset.created_at),
    })),
    createdAt: text(row.created_at),
  };
}

export function listWordPalettes(
  db: Database.Database,
  locale: Locale,
  readTerm: TermReader,
  paletteId?: string,
): WordPaletteDto[] {
  const rows = db
    .prepare(
      `SELECT p.*,
    (SELECT count(*) FROM prompt_palette_bindings b WHERE b.palette_id = p.id) AS usage_count
    FROM word_palettes p WHERE p.deleted_at IS NULL
      AND (? IS NULL OR p.id = ?)
    ORDER BY (p.archived_at IS NOT NULL) ASC, p.pinned DESC, p.updated_at DESC, p.id ASC`,
    )
    .all(paletteId ?? null, paletteId ?? null) as JsonMap[];
  const paletteIds = rows.map((row) => text(row.id));
  if (!paletteIds.length) return [];
  const placeholders = paletteIds.map(() => '?').join(', ');
  const revisionRows = db
    .prepare(
      `SELECT revision.*,
      COALESCE((
        SELECT json_group_array(json_object(
          'locale', localization.locale,
          'name', localization.name,
          'description', localization.description
        ))
        FROM (
          SELECT locale, name, description FROM word_palette_revision_localizations
          WHERE palette_revision_id = revision.id ORDER BY locale
        ) localization
      ), '[]') AS localizations_json
    FROM word_palette_revisions revision
    WHERE palette_id IN (${placeholders}) ORDER BY palette_id, revision_no DESC`,
    )
    .all(...paletteIds) as JsonMap[];
  const revisionsByPalette = groupRows(revisionRows, 'palette_id');
  const details = loadPaletteReadDetails(db, paletteIds);

  return rows.map((row) => {
    const revisions = (revisionsByPalette.get(text(row.id)) ?? []).map((revision) =>
      readPaletteRevision(revision, locale, readTerm, details),
    );
    const current = revisions.find((revision) => revision.id === row.current_revision_id) ?? revisions[0];
    if (!current) throw new Error(`Word palette has no revision: ${text(row.id)}`);
    return {
      id: text(row.id),
      revisionId: current.id,
      revisionNo: current.revisionNo,
      name: current.name,
      nameLocale: current.nameLocale,
      description: current.description,
      localizations: current.localizations,
      kind: current.kind,
      status: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
      terms: current.terms,
      parameters: current.parameters,
      promptNodes: current.promptNodes,
      referenceAssets: current.referenceAssets,
      revisions,
      usageCount: Number(row.usage_count),
      updatedAt: text(row.updated_at),
    };
  });
}

export function createWordPalette(db: Database.Database, input: CreateWordPaletteInput, timestamp: string): string {
  const normalized = validateWordPaletteInput(db, input);
  const paletteId = ulid();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO word_palettes
      (id, pinned, created_at, updated_at, archived_at, deleted_at, current_revision_id)
      VALUES (?, 0, ?, ?, NULL, NULL, NULL)`,
    ).run(paletteId, timestamp, timestamp);
    createPaletteRevision(db, paletteId, normalized, timestamp);
  })();
  return paletteId;
}

export function updateWordPalette(db: Database.Database, input: UpdateWordPaletteInput, timestamp: string) {
  const normalized = validateWordPaletteInput(db, input);
  db.transaction(() => {
    const existing = db.prepare('SELECT 1 FROM word_palettes WHERE id = ? AND deleted_at IS NULL').get(input.paletteId);
    if (!existing) throw new Error('Word palette not found');
    createPaletteRevision(db, input.paletteId, normalized, timestamp);
  })();
}

function validateWordPaletteInput(db: Database.Database, input: CreateWordPaletteInput): NormalizedPalette {
  const normalizeLocale = (value: string) => value.trim().toLocaleLowerCase();
  const name = input.name.trim();
  const nameLocale = normalizeLocale(input.nameLocale);
  if (!name || !nameLocale) throw new Error('Palette name and language are required');
  const localizationLocales = new Set<string>();
  const localizations = input.localizations
    .map((localization) => ({
      locale: normalizeLocale(localization.locale),
      name: localization.name.trim(),
      description: localization.description.trim(),
    }))
    .filter((localization) => localization.locale !== nameLocale && Boolean(localization.name))
    .map((localization) => {
      if (localizationLocales.has(localization.locale)) throw new Error('Duplicate palette localization');
      localizationLocales.add(localization.locale);
      return localization;
    })
    .sort((left, right) => left.locale.localeCompare(right.locale));
  const referenceAssetIds = [...new Set(input.referenceAssetIds)];
  for (const assetId of referenceAssetIds) {
    if (!db.prepare('SELECT 1 FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(assetId)) {
      throw new Error(`Unknown palette reference image: ${assetId}`);
    }
  }
  const referencedTermIds = new Set<string>();
  const normalizeContent = (content: WordPaletteContentInput): WordPaletteContentInput | null => {
    if (content.kind === 'TERM') {
      const termId = content.termId.trim();
      if (!termId) throw new Error('Palette content term is required');
      referencedTermIds.add(termId);
      return { kind: 'TERM', termId };
    }
    const promptFragment = content.promptFragment;
    const negativeFragment = content.negativeFragment;
    const hasContent = Boolean(promptFragment.length || negativeFragment.length);
    return hasContent ? { kind: 'TEXT', promptFragment, negativeFragment } : null;
  };
  const parameterKeys = new Set<string>();
  const parameters = input.parameters.map((parameter): WordPaletteParameterInput => {
    const stableKey = parameter.stableKey.trim();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(stableKey)) throw new Error('Invalid parameter key');
    if (parameterKeys.has(stableKey)) throw new Error('Duplicate parameter key');
    const name = parameter.name.trim();
    const nameLocale = normalizeLocale(parameter.nameLocale);
    if (!name || !nameLocale) throw new Error('Parameter name and language are required');
    const parameterLocalizationLocales = new Set<string>();
    const localizations = parameter.localizations
      .map((localization) => ({ locale: normalizeLocale(localization.locale), name: localization.name.trim() }))
      .filter((localization) => localization.locale !== nameLocale && Boolean(localization.name))
      .map((localization) => {
        if (parameterLocalizationLocales.has(localization.locale)) {
          throw new Error('Duplicate parameter localization');
        }
        parameterLocalizationLocales.add(localization.locale);
        return localization;
      })
      .sort((left, right) => left.locale.localeCompare(right.locale));
    if (!parameter.options.length) throw new Error('Parameter options are required');
    const options = parameter.options.map((option) => {
      const value = option.value.trim();
      const label = option.label.trim() || value;
      const labelLocale = normalizeLocale(option.labelLocale);
      if (!labelLocale) throw new Error('Option label language is required');
      const optionLocalizationLocales = new Set<string>();
      const optionLocalizations = option.localizations
        .map((localization) => ({ locale: normalizeLocale(localization.locale), label: localization.label.trim() }))
        .filter((localization) => localization.locale !== labelLocale && Boolean(localization.label))
        .map((localization) => {
          if (optionLocalizationLocales.has(localization.locale)) throw new Error('Duplicate option localization');
          optionLocalizationLocales.add(localization.locale);
          return localization;
        })
        .sort((left, right) => left.locale.localeCompare(right.locale));
      return {
        value,
        label,
        labelLocale,
        localizations: optionLocalizations,
        contents: option.contents.flatMap((content) => normalizeContent(content) ?? []),
      };
    });
    const optionValues = options.map((option) => option.value);
    if (optionValues.some((value) => !value) || new Set(optionValues).size !== optionValues.length) {
      throw new Error('Palette parameter options must be unique');
    }
    parameterKeys.add(stableKey);
    return {
      stableKey,
      name,
      nameLocale,
      localizations,
      required: parameter.required,
      options,
    };
  });
  const promptNodes = input.promptNodes.flatMap<WordPalettePromptNodeInput>((node) => {
    if (node.kind === 'SLOT') {
      const stableKey = node.stableKey.trim();
      if (!parameterKeys.has(stableKey)) throw new Error(`Unknown palette variation: ${stableKey}`);
      return [{ kind: 'SLOT' as const, stableKey }];
    }
    const content = normalizeContent(node);
    return content ? [content] : [];
  });
  const slotKeys = promptNodes.flatMap((node) => (node.kind === 'SLOT' ? [node.stableKey] : []));
  if (new Set(slotKeys).size !== slotKeys.length) throw new Error('Duplicate palette variation slot');
  if (parameters.some((parameter) => !slotKeys.includes(parameter.stableKey))) {
    throw new Error('Every palette variation needs a Prompt slot');
  }
  for (const termId of referencedTermIds) {
    if (!db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(termId)) {
      throw new Error(`Unknown palette term: ${termId}`);
    }
  }
  const termIds = [...referencedTermIds];
  const hasPromptContent = Boolean(
    promptNodes.some((node) => node.kind !== 'TEXT' || node.promptFragment.length || node.negativeFragment.length),
  );
  if (!termIds.length && !parameters.length && !referenceAssetIds.length && !hasPromptContent) {
    throw new Error('A word palette needs Prompt content, variations, terms, or reference images');
  }
  return {
    name,
    nameLocale,
    description: input.description.trim(),
    localizations,
    termIds,
    referenceAssetIds,
    parameters,
    promptNodes,
  };
}

export function archiveWordPalette(db: Database.Database, paletteId: string, archived: boolean, timestamp: string) {
  const existing = db
    .prepare('SELECT archived_at FROM word_palettes WHERE id = ? AND deleted_at IS NULL')
    .get(paletteId) as JsonMap | undefined;
  if (!existing) throw new Error('Word palette not found');
  db.prepare('UPDATE word_palettes SET archived_at = ?, updated_at = ? WHERE id = ?').run(
    archived ? timestamp : null,
    timestamp,
    paletteId,
  );
}

export function deleteWordPalette(db: Database.Database, paletteId: string, timestamp: string) {
  const result = db
    .prepare(
      `UPDATE word_palettes SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(timestamp, timestamp, paletteId);
  if (!result.changes) throw new Error('Word palette not found');
}
