CREATE TABLE agent_intake_receipts (
  request_id TEXT PRIMARY KEY CHECK(length(trim(request_id)) > 0),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL
);
