import { ensureArticleDeliveryWatermark } from '@/main/database/extensions/article-delivery-job-schema';
import type Database from 'better-sqlite3';
import { ensureAgentIntakeSchema } from '@/main/database/core/agent-intake-schema';
import type { ArticleStorageShape } from '@/main/database/creations/article-storage-schema';
import articleCommentDecisionsSql from '@/main/database/sql/v03-revision-005-article-comment-decisions.sql?raw';
import articleElementsSql from '@/main/database/sql/v03-revision-005-article-elements.sql?raw';
import articleCommentsSql from '@/main/database/sql/v03-revision-005-article-comments.sql?raw';
import articleDeliveryJobsSql from '@/main/database/sql/v03-revision-005-article-delivery-jobs.sql?raw';
import articleRevisionPacksSql from '@/main/database/sql/v03-revision-005-article-revision-packs.sql?raw';
import agentCliSql from '@/main/database/sql/v03-revision-005-agent-cli.sql?raw';
import backgroundIssueAcknowledgementsSql from '@/main/database/sql/v03-revision-005-background-issue-acknowledgements.sql?raw';
import revision5Sql from '@/main/database/sql/v03-revision-005.sql?raw';
export { agentCliShape } from '@/main/database/core/agent-cli-schema';

type CreationLibraryShape = 'ABSENT' | 'MISSING_PINNED' | 'PRE_LINEAGE' | 'LINEAGE' | 'IMAGE_BREAKDOWN' | 'COMPLETE';
type ImageBreakdownShape = 'ABSENT' | 'LEGACY_ROUTE_CONSTRAINT' | 'COMPLETE';
type EvaluationSuiteShape = 'ABSENT' | 'COMPLETE';

interface Revision5SourceShape {
  creationLibrary: CreationLibraryShape;
  imageBreakdown: ImageBreakdownShape;
  evaluationSuite: EvaluationSuiteShape;
  articleStorage: ArticleStorageShape;
  articleDeliveryJobsComplete: boolean;
  agentCliComplete: boolean;
  backgroundIssueAcknowledgementsComplete: boolean;
  contentLifecycleComplete: boolean;
}

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function createCreationFormsSource(db: Database.Database, hasLineage: boolean) {
  const sourceFormProjection = hasLineage ? 'source_form_id' : 'NULL AS source_form_id';
  db.exec(`CREATE TEMP VIEW aiy_revision_5_creation_forms_source AS
    SELECT id, creation_item_id, ${sourceFormProjection}, role, entity_type, entity_id,
      anchor_key, sort_order, created_at, updated_at, deleted_at
    FROM creation_forms`);
}

function createImageBreakdownsSource(db: Database.Database, present: boolean) {
  db.exec(
    present
      ? `CREATE TEMP VIEW aiy_revision_5_image_breakdowns_source AS
          SELECT id, source_asset_id, title, focus, route_key, model_key, status,
            result_json, error_code, error_message, created_at, updated_at, archived_at, deleted_at
          FROM image_breakdowns`
      : `CREATE TEMP VIEW aiy_revision_5_image_breakdowns_source AS
          SELECT NULL AS id, NULL AS source_asset_id, NULL AS title, NULL AS focus,
            NULL AS route_key, NULL AS model_key, NULL AS status, NULL AS result_json,
            NULL AS error_code, NULL AS error_message, NULL AS created_at, NULL AS updated_at,
            NULL AS archived_at, NULL AS deleted_at
          WHERE 0`,
  );
}

function createEvaluationSuiteSources(db: Database.Database, present: boolean) {
  db.exec(
    present
      ? `CREATE TEMP VIEW aiy_revision_5_evaluation_suites_source AS
          SELECT id, album_id, current_revision_id, status, created_at, updated_at, archived_at, deleted_at
          FROM evaluation_suites`
      : `CREATE TEMP VIEW aiy_revision_5_evaluation_suites_source AS
          SELECT NULL AS id, NULL AS album_id, NULL AS current_revision_id, NULL AS status,
            NULL AS created_at, NULL AS updated_at, NULL AS archived_at, NULL AS deleted_at
          WHERE 0`,
  );
  db.exec(
    present
      ? `CREATE TEMP VIEW aiy_revision_5_evaluation_suite_revisions_source AS
          SELECT id, suite_id, revision_no, content_json, content_hash, created_at
          FROM evaluation_suite_revisions`
      : `CREATE TEMP VIEW aiy_revision_5_evaluation_suite_revisions_source AS
          SELECT NULL AS id, NULL AS suite_id, NULL AS revision_no, NULL AS content_json,
            NULL AS content_hash, NULL AS created_at
          WHERE 0`,
  );
}

export function ensureRevision5Schema(db: Database.Database, shape: Revision5SourceShape) {
  const featureSchemaComplete =
    shape.creationLibrary === 'COMPLETE' && shape.imageBreakdown === 'COMPLETE' && shape.evaluationSuite === 'COMPLETE';
  if (!shape.contentLifecycleComplete || shape.articleStorage === 'ABSENT') unsupportedSchema();

  if (!featureSchemaComplete) {
    const supportedSource =
      ((shape.creationLibrary === 'PRE_LINEAGE' || shape.creationLibrary === 'LINEAGE') &&
        shape.imageBreakdown === 'ABSENT' &&
        shape.evaluationSuite === 'ABSENT') ||
      (shape.creationLibrary === 'IMAGE_BREAKDOWN' &&
        shape.imageBreakdown !== 'ABSENT' &&
        shape.evaluationSuite === 'ABSENT') ||
      (shape.creationLibrary === 'COMPLETE' &&
        shape.imageBreakdown !== 'ABSENT' &&
        shape.evaluationSuite === 'COMPLETE');
    if (!supportedSource) unsupportedSchema();

    createCreationFormsSource(db, shape.creationLibrary !== 'PRE_LINEAGE');
    createImageBreakdownsSource(db, shape.imageBreakdown !== 'ABSENT');
    createEvaluationSuiteSources(db, shape.evaluationSuite === 'COMPLETE');
    db.exec(revision5Sql);
  }

  if (shape.articleStorage === 'UNPACKED') db.exec(articleRevisionPacksSql);
  if (shape.articleStorage === 'UNPACKED' || shape.articleStorage === 'PACKED') db.exec(articleElementsSql);
  if (shape.articleStorage === 'LEGACY_COMMENT_STATUS') db.exec(articleCommentDecisionsSql);
  else if (shape.articleStorage !== 'COMPLETE') db.exec(articleCommentsSql);
  if (!shape.articleDeliveryJobsComplete) db.exec(articleDeliveryJobsSql);
  ensureArticleDeliveryWatermark(db);
  if (!shape.agentCliComplete) db.exec(agentCliSql);
  ensureAgentIntakeSchema(db);
  if (!shape.backgroundIssueAcknowledgementsComplete) db.exec(backgroundIssueAcknowledgementsSql);
}
