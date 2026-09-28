CREATE TABLE background_issue_acknowledgements_next (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  issue_kind TEXT NOT NULL CHECK(
    issue_kind IN ('GENERATION_RUN', 'DIRECTION_EXPERIMENT_DIRECTOR', 'ARTICLE_DELIVERY_JOB')
  ),
  subject_id TEXT NOT NULL CHECK(length(trim(subject_id)) > 0),
  occurrence_id TEXT NOT NULL CHECK(
    length(occurrence_id) = 64
    AND occurrence_id NOT GLOB '*[^0-9a-f]*'
  ),
  acknowledged_at TEXT NOT NULL CHECK(length(trim(acknowledged_at)) > 0),
  UNIQUE(issue_kind, subject_id, occurrence_id)
);

INSERT INTO background_issue_acknowledgements_next
  (id, issue_kind, subject_id, occurrence_id, acknowledged_at)
SELECT id, issue_kind, subject_id, occurrence_id, acknowledged_at
FROM background_issue_acknowledgements;

DROP TABLE background_issue_acknowledgements;
ALTER TABLE background_issue_acknowledgements_next RENAME TO background_issue_acknowledgements;
