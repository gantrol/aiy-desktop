import type Database from 'better-sqlite3';
import type {
  PromptCommonParameterReferenceDto,
  PromptCommonRecipeContentDto,
  PromptCommonRecipeNodeDto,
  PromptCommonTermReferenceDto,
} from '@/shared/contracts';
import { type JsonMap, text } from '@/main/database/values';

function tableExists(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function termReference(db: Database.Database, termId: string): PromptCommonTermReferenceDto {
  const row = db.prepare('SELECT current_revision_id FROM terms WHERE id = ?').get(termId) as JsonMap | undefined;
  if (!row?.current_revision_id) throw new Error(`Term revision not found: ${termId}`);
  return { termId, termRevisionId: text(row.current_revision_id) };
}

function selectedParameters(db: Database.Database, revisionId: string, values: Record<string, string>) {
  const rows = db
    .prepare(
      `SELECT parameter.id AS parameter_revision_id,
      parameter.stable_key, option.id AS option_id, option.value_key
    FROM word_palette_revision_parameters parameter
    JOIN word_palette_revision_parameter_options option ON option.parameter_revision_id = parameter.id
    WHERE parameter.palette_revision_id = ?
    ORDER BY parameter.sort_order, option.sort_order`,
    )
    .all(revisionId) as JsonMap[];
  return new Map(
    rows.flatMap((row) =>
      values[text(row.stable_key)] === text(row.value_key)
        ? [
            [
              text(row.stable_key),
              {
                parameterRevisionId: text(row.parameter_revision_id),
                stableKey: text(row.stable_key),
                optionId: text(row.option_id),
                valueKey: text(row.value_key),
              } satisfies PromptCommonParameterReferenceDto,
            ] as const,
          ]
        : [],
    ),
  );
}

function optionContents(db: Database.Database, optionId: string): PromptCommonRecipeContentDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM word_palette_revision_option_contents
    WHERE option_id = ? ORDER BY sort_order`,
    )
    .all(optionId) as JsonMap[];
  return rows.map((row) =>
    text(row.kind) === 'TERM'
      ? {
          id: text(row.id),
          kind: 'TERM' as const,
          term: termReference(db, text(row.term_id)),
        }
      : {
          id: text(row.id),
          kind: 'TEXT' as const,
          promptFragment: text(row.prompt_fragment),
          negativeFragment: text(row.negative_fragment),
        },
  );
}

export function readRecipeContentSnapshot(
  db: Database.Database,
  revisionId: string,
  values: Record<string, string>,
): PromptCommonRecipeNodeDto[] {
  if (!tableExists(db, 'word_palette_revision_content_nodes')) return [];
  const selections = selectedParameters(db, revisionId, values);
  const rows = db
    .prepare(
      `SELECT node.*, parameter.stable_key
    FROM word_palette_revision_content_nodes node
    LEFT JOIN word_palette_revision_parameters parameter ON parameter.id = node.parameter_revision_id
    WHERE node.palette_revision_id = ? ORDER BY node.sort_order`,
    )
    .all(revisionId) as JsonMap[];
  return rows.map((row): PromptCommonRecipeNodeDto => {
    if (text(row.kind) === 'TERM') {
      return { id: text(row.id), kind: 'TERM', term: termReference(db, text(row.term_id)) };
    }
    if (text(row.kind) === 'SLOT') {
      const stableKey = text(row.stable_key);
      const parameter = selections.get(stableKey) ?? null;
      return {
        id: text(row.id),
        kind: 'SLOT',
        stableKey,
        parameter,
        contents: parameter ? optionContents(db, parameter.optionId) : [],
      };
    }
    return {
      id: text(row.id),
      kind: 'TEXT',
      promptFragment: text(row.prompt_fragment),
      negativeFragment: text(row.negative_fragment),
    };
  });
}

export function recipeContentTerms(nodes: readonly PromptCommonRecipeNodeDto[]) {
  const terms = nodes.flatMap((node) =>
    node.kind === 'TERM'
      ? [node.term]
      : node.kind === 'SLOT'
        ? node.contents.flatMap((content) => (content.kind === 'TERM' ? [content.term] : []))
        : [],
  );
  const seen = new Set<string>();
  return terms.filter((term) => {
    if (seen.has(term.termId)) return false;
    seen.add(term.termId);
    return true;
  });
}
