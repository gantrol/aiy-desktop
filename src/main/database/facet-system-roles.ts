import type Database from 'better-sqlite3';
import type { FacetSystemRole } from '@/shared/contracts';

export type FacetSystemRoleAssignments = Partial<Record<FacetSystemRole, string>>;

export function assignFacetSystemRoles(db: Database.Database, assignments: FacetSystemRoleAssignments) {
  const entries = Object.entries(assignments) as Array<[FacetSystemRole, string | undefined]>;
  const stableKeys = entries
    .map(([, stableKey]) => stableKey?.trim())
    .filter((stableKey): stableKey is string => Boolean(stableKey));
  if (new Set(stableKeys).size !== stableKeys.length) {
    throw new Error('A facet cannot fill more than one system role');
  }

  const resolved = entries.flatMap(([role, rawStableKey]) => {
    const stableKey = rawStableKey?.trim();
    if (!stableKey) return [];
    const definition = db.prepare('SELECT id FROM facet_definitions WHERE stable_key = ?').get(stableKey) as
      { id: string } | undefined;
    if (!definition) throw new Error(`Facet system role references an unknown facet: ${stableKey}`);
    return [{ role, definitionId: definition.id }];
  });

  db.transaction(() => {
    for (const { role, definitionId } of resolved) {
      db.prepare('UPDATE facet_definitions SET system_role = NULL WHERE system_role = ?').run(role);
      db.prepare('UPDATE facet_definitions SET system_role = ? WHERE id = ?').run(role, definitionId);
    }
    db.prepare(
      `INSERT OR IGNORE INTO term_directory_placements
        (term_id, domain_facet_value_id, item_type_facet_value_id, created_at, updated_at)
      SELECT id, NULL, NULL,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM terms`,
    ).run();
    db.prepare(
      `UPDATE term_directory_placements
      SET domain_facet_value_id = (
            SELECT value.id
            FROM terms term
            JOIN term_facet_assignments assignment ON assignment.term_revision_id = term.current_revision_id
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE term.id = term_directory_placements.term_id
              AND definition.system_role = 'PRIMARY_CLASSIFICATION'
            ORDER BY value.sort_order, value.id
            LIMIT 1
          ),
          item_type_facet_value_id = (
            SELECT value.id
            FROM terms term
            JOIN term_facet_assignments assignment ON assignment.term_revision_id = term.current_revision_id
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE term.id = term_directory_placements.term_id
              AND definition.system_role = 'SECONDARY_CLASSIFICATION'
            ORDER BY value.sort_order, value.id
            LIMIT 1
          ),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run();
  })();
}
