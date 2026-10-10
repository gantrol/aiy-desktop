import Database from 'better-sqlite3';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { digest } from '@/main/model-training/io';
import { validateDataset } from '@/main/model-training/dataset';
import type { TrainingCase, TrainingDataset } from '@/shared/model-training';

interface Term {
  id: string;
  revision: string;
  key: string;
  title: string;
  definition: string;
  locale: string;
  domains: string[];
  queries: string[];
}
interface Link {
  termId: string;
  id: string;
  revision: string;
  relative: string;
  mime: TrainingDataset['entries'][number]['mime'];
  bytes: number;
  reference: string;
  role: string;
  note: string;
}

/** Explicit CLI data preparation: no migrations, writes to the source DB, or automatic negative mining. */
export async function seedDictionary(
  library: string,
  limit: number,
  excluded: Set<string>,
  selection: { facetKey?: string; excludedFacetValues: string[] },
) {
  if (selection.excludedFacetValues.length && !selection.facetKey) throw new Error('FACET_KEY_REQUIRED');
  const root = await realpath(library);
  const db = new Database(path.join(root, 'library.sqlite3'), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let terms: Term[];
  let links: Link[];
  try {
    db.exec('BEGIN');
    const rows = db
      .prepare(
        `SELECT t.id,t.stable_key AS key,r.id AS revision,r.title,r.definition,r.title_locale AS locale
      FROM terms t JOIN term_revisions r ON r.id=t.current_revision_id
      WHERE t.archived_at IS NULL AND t.editorial_state='APPROVED' ORDER BY t.id LIMIT 10001`,
      )
      .all() as Omit<Term, 'domains' | 'queries'>[];
    if (rows.length > 10000) throw new Error('DICTIONARY_TERM_BUDGET');
    const selectedRevisions = JSON.stringify(rows.map((item) => item.revision));
    const queryRows = db
      .prepare(
        `SELECT term_revision_id AS revision,title AS value FROM term_localizations
      WHERE term_revision_id IN (SELECT value FROM json_each(?))
      UNION ALL SELECT term_revision_id AS revision,value FROM term_aliases
      WHERE term_revision_id IN (SELECT value FROM json_each(?)) LIMIT 40001`,
      )
      .all(selectedRevisions, selectedRevisions) as { revision: string; value: string }[];
    if (queryRows.length > 40000) throw new Error('DICTIONARY_QUERY_BUDGET');
    const facets = db
      .prepare(
        `SELECT a.term_revision_id AS revision,v.stable_key AS value
      FROM term_facet_assignments a JOIN facet_values v ON v.id=a.facet_value_id
      JOIN facet_definitions d ON d.id=v.definition_id
      WHERE d.stable_key=? AND a.term_revision_id IN (SELECT value FROM json_each(?))
      ORDER BY d.sort_order,v.sort_order`,
      )
      .all(selection.facetKey ?? null, selectedRevisions) as { revision: string; value: string }[];
    const aliases = groupRows(queryRows);
    const domains = groupRows(facets);
    terms = rows.map((item) => ({
      ...item,
      domains: domains.get(item.revision) ?? ['unclassified'],
      queries: [
        ...new Map(
          [item.title, ...(aliases.get(item.revision) ?? [])]
            .filter((value) => value.trim() && value.length <= 200)
            .map((value) => [normalize(value), value.trim()]),
        ).values(),
      ],
    }));
    links = db
      .prepare(
        `WITH relations AS (
      SELECT term_id,image_asset_id,id AS reference,role,'' AS note FROM term_media_links WHERE deleted_at IS NULL
      UNION ALL SELECT term_id,image_asset_id,id AS reference,verdict AS role,note FROM term_evidence
    ) SELECT r.term_id AS termId,a.id,a.object_hash AS revision,a.relative_path AS relative,
      a.mime_type AS mime,a.byte_size AS bytes,r.reference,r.role,r.note
      FROM relations r JOIN terms t ON t.id=r.term_id JOIN image_assets a ON a.id=r.image_asset_id
      WHERE t.archived_at IS NULL AND t.editorial_state='APPROVED' AND a.deleted_at IS NULL
        AND a.mime_type IN ('image/png','image/jpeg','image/webp')
        AND a.byte_size BETWEEN 1 AND 33554432 AND lower(a.relative_path) NOT LIKE '%trash%'
      ORDER BY r.term_id,a.id,r.reference LIMIT 20001`,
      )
      .all() as Link[];
    if (links.length > 20000) throw new Error('DICTIONARY_LINK_BUDGET');
    db.exec('COMMIT');
  } finally {
    db.close();
  }

  const linksByTerm = new Map<string, Link[]>();
  for (const link of links) {
    const values = linksByTerm.get(link.termId) ?? [];
    values.push(link);
    linksByTerm.set(link.termId, values);
  }
  const available = terms.filter(
    (term) =>
      !term.domains.some((value) => selection.excludedFacetValues.includes(value)) &&
      term.queries.length &&
      !(linksByTerm.get(term.id) ?? []).some((link) => excluded.has(link.revision)),
  );
  const selected: Term[] = [];
  const entries = new Map<string, TrainingDataset['entries'][number]>();
  const usable = new Map<string, Link[]>();
  let queryCount = 0;
  for (const term of stratify(available, linksByTerm)) {
    if (selected.length >= limit) break;
    const relations = linksByTerm.get(term.id) ?? [];
    const hashes = new Set(relations.map((link) => link.revision));
    if (
      entries.size + [...hashes].filter((hash) => !entries.has(hash)).length > 256 ||
      queryCount + term.queries.length > 512
    )
      continue;
    const readable: Link[] = [];
    for (const link of relations) {
      if (entries.has(link.revision)) {
        readable.push(link);
        continue;
      }
      if (path.isAbsolute(link.relative)) continue;
      const file = path.resolve(root, link.relative);
      if (!file.startsWith(root + path.sep)) continue;
      const resolved = await realpath(file).catch(() => '');
      if (!resolved.startsWith(root + path.sep) || resolved.toLowerCase().includes('trash')) continue;
      const info = await stat(resolved).catch(() => null);
      if (!info?.isFile() || info.size !== link.bytes) continue;
      entries.set(link.revision, {
        id: link.id,
        revision: link.revision,
        sourceGroup: link.revision,
        title: term.title,
        path: resolved,
        mime: link.mime,
      });
      readable.push(link);
    }
    usable.set(term.id, readable);
    selected.push(term);
    queryCount += term.queries.length;
  }
  const { cases, reviews } = dictionaryCases(selected, usable, entries);
  const dataset = validateDataset({ schema: 1, protocol: 'known_corpus', entries: [...entries.values()], cases });
  return {
    dataset,
    manifest: {
      schema: 1,
      datasetId: digest(dataset),
      kind: 'dictionary-training-seed',
      selectedTerms: selected.length,
      availableTerms: available.length,
      queryCount: cases.length,
      imageCount: entries.size,
      domainCounts: Object.fromEntries(
        [...new Set(selected.flatMap((term) => term.domains))].map((domain) => [
          domain,
          selected.filter((term) => term.domains.includes(domain)).length,
        ]),
      ),
      excludedSourceGroups: excluded.size,
      facetSelection: selection,
      sources: selected,
      reviews,
      labelsReviewed: false,
      limitations: [
        'ASSOCIATIONS_ARE_PROVISIONAL',
        'UNLINKED_IS_UNKNOWN',
        'NEGATIVE_EVIDENCE_IS_NOT_RETRIEVAL_NEGATIVE',
        'DICTIONARY_SEEDS_ARE_TRAIN_ONLY',
        'REQUIRES_REVIEWED_NEGATIVES_AND_INDEPENDENT_VALIDATION',
      ],
    },
  };
}

function dictionaryCases(
  terms: Term[],
  usable: Map<string, Link[]>,
  entries: Map<string, TrainingDataset['entries'][number]>,
) {
  const parents = new Map(terms.map((term) => [term.id, term.id]));
  const root = (id: string): string => {
    const parent = parents.get(id)!;
    if (parent === id) return id;
    const result = root(parent);
    parents.set(id, result);
    return result;
  };
  const owners = new Map<string, string>();
  for (const term of terms) {
    const keys = [
      ...term.queries.map((query) => `q:${normalize(query)}`),
      ...(usable.get(term.id) ?? []).map((link) => `i:${link.revision}`),
    ];
    for (const key of keys) {
      const previous = owners.get(key);
      if (previous) parents.set(root(term.id), root(previous));
      else owners.set(key, term.id);
    }
  }
  const cases = new Map<string, TrainingCase>();
  const reviews: { termId: string; imageId: string; reason: string; references: Link[] }[] = [];
  for (const term of terms) {
    const relations = usable.get(term.id) ?? [];
    const images = new Map<string, Link[]>();
    for (const link of relations) images.set(link.revision, [...(images.get(link.revision) ?? []), link]);
    const judgments = [...images.entries()].map(([hash, references]) => {
      const id = entries.get(hash)!.id;
      const rejected = references.some((item) => item.role === 'NEGATIVE');
      const positive = references.some((item) => ['COVER', 'RELATED', 'POSITIVE', 'ACCEPTED'].includes(item.role));
      if (rejected)
        reviews.push({
          termId: term.id,
          imageId: id,
          reason: positive ? 'CONFLICT_OR_QUALITY_REJECTION' : 'QUALITY_REJECTION_NEEDS_RETRIEVAL_JUDGMENT',
          references,
        });
      return {
        id,
        relevance: !rejected && positive ? ('positive' as const) : ('unknown' as const),
        origin: 'dictionary_link' as const,
        assessor: 'dictionary-import',
        note: `term=${term.id};revision=${term.revision};references=${references.map((item) => item.reference).join(',')}`.slice(
          0,
          2000,
        ),
      };
    });
    for (const query of term.queries) {
      const key = normalize(query);
      const previous = cases.get(key);
      const labels = new Map((previous?.judgments ?? []).map((label) => [label.id, label]));
      for (const label of judgments) {
        const existing = labels.get(label.id);
        labels.set(
          label.id,
          existing && existing.relevance !== label.relevance ? { ...label, relevance: 'unknown' } : label,
        );
      }
      cases.set(key, {
        id: `dictionary-${digest(key).slice(0, 24)}`,
        query,
        group: `dictionary-${root(term.id)}`,
        split: 'train',
        expected: [...labels.values()].some((label) => label.relevance === 'positive') ? 'has_result' : 'unknown',
        intent: 'Find visual examples of this dictionary concept. Imported associations require relevance review.',
        judgments: [...labels.values()],
      });
    }
  }
  return { cases: [...cases.values()], reviews };
}

function stratify(terms: Term[], links: Map<string, Link[]>) {
  const buckets = new Map<string, Term[]>();
  for (const term of terms) {
    const count = new Set(
      (links.get(term.id) ?? []).filter((link) => link.role !== 'NEGATIVE').map((link) => link.revision),
    ).size;
    const key = `${term.domains[0]}:${count === 0 ? 'zero' : count === 1 ? 'one' : 'many'}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(term);
    buckets.set(key, bucket);
  }
  const ordered = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => bucket.sort((a, b) => digest(a.key).localeCompare(digest(b.key))));
  const result: Term[] = [];
  for (let index = 0; ordered.some((bucket) => bucket.length > index); index++)
    for (const bucket of ordered) if (bucket[index]) result.push(bucket[index]);
  return result;
}

function groupRows(rows: { revision: string; value: string }[]) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) grouped.set(row.revision, [...(grouped.get(row.revision) ?? []), row.value]);
  return grouped;
}
function normalize(query: string) {
  return query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
