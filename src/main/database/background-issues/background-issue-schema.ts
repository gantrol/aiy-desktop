import type Database from 'better-sqlite3';
import { columnNames, tableNames, unsupportedSchema } from '@/main/database/core/schema-inspection';
import backgroundIssueAcknowledgementsSql from '@/main/database/sql/v03-revision-005-background-issue-acknowledgements.sql?raw';
import articleDeliveryBackgroundIssuesSql from '@/main/database/sql/v03-revision-008-article-delivery-background-issues.sql?raw';

export function backgroundIssueAcknowledgementShape(db: Database.Database) {
  if (!tableNames(db).has('background_issue_acknowledgements')) return 'ABSENT' as const;
  const columns = columnNames(db, 'background_issue_acknowledgements');
  const required = ['id', 'issue_kind', 'subject_id', 'occurrence_id', 'acknowledged_at'];
  if (!required.every((column) => columns.has(column))) unsupportedSchema();
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'background_issue_acknowledgements'")
    .pluck()
    .get();
  if (typeof definition !== 'string') unsupportedSchema();
  const normalizedDefinition = definition.replace(/\s+/g, ' ');
  if (
    !normalizedDefinition.includes("'GENERATION_RUN'") ||
    !normalizedDefinition.includes("'DIRECTION_EXPERIMENT_DIRECTOR'") ||
    !normalizedDefinition.includes('UNIQUE(issue_kind, subject_id, occurrence_id)')
  ) {
    unsupportedSchema();
  }
  if (normalizedDefinition.includes("'ARTICLE_DELIVERY_JOB'")) return 'COMPLETE' as const;
  return 'MISSING_ARTICLE_DELIVERY' as const;
}

export function ensureBackgroundIssueAcknowledgements(db: Database.Database) {
  const shape = backgroundIssueAcknowledgementShape(db);
  if (shape === 'ABSENT') db.exec(backgroundIssueAcknowledgementsSql);
  if (shape !== 'COMPLETE') db.exec(articleDeliveryBackgroundIssuesSql);
}
