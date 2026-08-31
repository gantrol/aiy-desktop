CREATE TABLE background_issue_acknowledgements (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  issue_kind TEXT NOT NULL CHECK(
    issue_kind IN ('GENERATION_RUN', 'DIRECTION_EXPERIMENT_DIRECTOR')
  ),
  subject_id TEXT NOT NULL CHECK(length(trim(subject_id)) > 0),
  occurrence_id TEXT NOT NULL CHECK(
    length(occurrence_id) = 64
    AND occurrence_id NOT GLOB '*[^0-9a-f]*'
  ),
  acknowledged_at TEXT NOT NULL CHECK(length(trim(acknowledged_at)) > 0),
  UNIQUE(issue_kind, subject_id, occurrence_id)
);
