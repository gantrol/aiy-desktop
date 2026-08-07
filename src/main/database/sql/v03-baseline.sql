-- AIY 0.3.0 database baseline.
-- This is the first public-release schema. Pre-release databases are intentionally unsupported.

CREATE TABLE album_members (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('MATERIAL', 'SERIES', 'ALBUM')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(album_id, target_type, target_id)
);

CREATE TABLE "albums" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  intent TEXT NOT NULL DEFAULT '',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
, content_updated_at TEXT);

CREATE TABLE annotation_regions (
  annotation_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
  geometry_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  type TEXT NOT NULL CHECK(type IN ('RECTANGLE', 'BRUSH')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL,
  height REAL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE asset_derivations (
  id TEXT PRIMARY KEY,
  child_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  source_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  relation_type TEXT NOT NULL,
  generation_run_id TEXT REFERENCES generation_runs(id),
  created_at TEXT NOT NULL,
  UNIQUE(child_asset_id, source_asset_id, relation_type)
);

CREATE TABLE assistant_proposals (
  id TEXT PRIMARY KEY,
  assistant_run_id TEXT NOT NULL UNIQUE REFERENCES assistant_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('READY', 'EXPIRED', 'ADOPTED', 'CLOSED')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, adopted_context_key TEXT);

CREATE TABLE assistant_runs (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('optimize', 'directions')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  request_json TEXT NOT NULL,
  context_key TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  capability_receipt_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT, dismissed_at TEXT, provider_key TEXT NOT NULL DEFAULT 'codex', model_key TEXT NOT NULL DEFAULT 'codex', reasoning_effort TEXT
CHECK(reasoning_effort IS NULL OR reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
  CHECK(
    (status = 'RUNNING' AND finished_at IS NULL)
    OR (status <> 'RUNNING' AND finished_at IS NOT NULL)
  )
);

CREATE TABLE background_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
  recovery_mode TEXT NOT NULL,
  retryable INTEGER NOT NULL CHECK(retryable IN (0, 1)),
  worker_id TEXT,
  lease_expires_at TEXT,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress REAL CHECK(progress IS NULL OR (progress >= 0 AND progress <= 1)),
  status_message TEXT,
  provider_key TEXT,
  provider_request_id TEXT,
  checkpoint_json TEXT,
  last_heartbeat_at TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, attempt_no)
);

CREATE TABLE background_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  attempt_id TEXT REFERENCES background_job_attempts(id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  event_type TEXT NOT NULL,
  phase TEXT,
  progress REAL CHECK(progress IS NULL OR (progress >= 0 AND progress <= 1)),
  status_message TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, sequence)
);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress REAL CHECK(progress IS NULL OR (progress >= 0 AND progress <= 1)),
  status_message TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  not_before TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  root_job_id TEXT NOT NULL REFERENCES background_jobs(id),
  retry_of_job_id TEXT REFERENCES background_jobs(id),
  provider_key TEXT,
  provider_request_id TEXT,
  checkpoint_json TEXT,
  last_heartbeat_at TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE change_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY'
);

CREATE TABLE codex_image_discoveries (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  thread_name TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  file_created_at TEXT NOT NULL,
  file_modified_at TEXT NOT NULL,
  content_hash TEXT,
  imported_series_id TEXT REFERENCES prompt_series(id),
  imported_asset_id TEXT REFERENCES image_assets(id),
  imported_output_id TEXT REFERENCES creation_output_imports(id),
  imported_at TEXT,
  last_seen_scan_id TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  missing_at TEXT
);

CREATE TABLE codex_image_discovery_events (
  id TEXT PRIMARY KEY,
  discovery_id TEXT NOT NULL REFERENCES codex_image_discoveries(id),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('DISCOVERED', 'UPDATED', 'MISSING', 'RESTORED', 'IMPORTED')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE context_pack_activations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('ALBUM', 'CONVERSATION')),
  target_id TEXT NOT NULL CHECK(length(trim(target_id)) > 0),
  installation_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_release_id TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'EXPLICIT_ACTIVE'
    CHECK(state IN ('EXPLICIT_ACTIVE', 'EXPLICIT_DISABLED')),
  activation_source TEXT NOT NULL
    CHECK(activation_source IN ('USER', 'BUNDLE_DEFAULT')),
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE creation_draft_materials (
  id TEXT PRIMARY KEY,
  creation_draft_id TEXT NOT NULL REFERENCES creation_drafts(id),
  material_id TEXT NOT NULL REFERENCES materials(id),
  role TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(creation_draft_id, material_id)
);

CREATE TABLE creation_drafts (
  id TEXT PRIMARY KEY,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  source_series_id TEXT REFERENCES prompt_series(id),
  deleted_at TEXT
, title_zh TEXT NOT NULL DEFAULT '', title_en TEXT NOT NULL DEFAULT '', term_prompt_locale TEXT NOT NULL DEFAULT 'en', term_ids_json TEXT NOT NULL DEFAULT '[]', palette_references_json TEXT NOT NULL DEFAULT '[]', canvas_preset_key TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL DEFAULT 'low', selected_model_keys_json TEXT NOT NULL DEFAULT '[]', repeat_count INTEGER NOT NULL DEFAULT 1, model_targets_json TEXT NOT NULL DEFAULT '[]', target_album_id TEXT REFERENCES albums(id), dictionary_scope_mode TEXT NOT NULL DEFAULT 'ALL'
  CHECK(dictionary_scope_mode IN ('ALL', 'SELECTED')), dictionary_pack_sources_json TEXT NOT NULL DEFAULT '[]', dictionary_include_local_terms INTEGER NOT NULL DEFAULT 1
  CHECK(dictionary_include_local_terms IN (0, 1)), defaults_applied_at TEXT, prompt_nodes_json TEXT NOT NULL DEFAULT '[]');

CREATE TABLE creation_input_stashes (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL CHECK(length(trim(scope_id)) > 0),
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  input_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id, revision_no)
);

CREATE TABLE creator_agent_turns (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE dictionary_maintenance_reports (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL CHECK(locale IN ('zh', 'en')),
  source_hash TEXT NOT NULL,
  source_revision_count INTEGER NOT NULL CHECK(source_revision_count >= 0),
  summary_json TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE direction_experiment_director_tasks (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL CHECK(length(trim(scope_id)) > 0),
  source_assistant_run_id TEXT NOT NULL REFERENCES assistant_runs(id),
  style_exploration_batch_id TEXT NOT NULL UNIQUE REFERENCES style_exploration_batches(id) ON DELETE CASCADE,
  objective TEXT NOT NULL CHECK(length(trim(objective)) > 0),
  authorization_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE execution_input_snapshots (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
  model_snapshot_id TEXT NOT NULL UNIQUE REFERENCES generation_model_snapshots(id),
  route_kind TEXT NOT NULL CHECK (route_kind IN ('CODEX_CLI', 'PROVIDER_ADAPTER', 'INTERNAL_REPLAY', 'MODEL_INPUT')),
  request_schema TEXT NOT NULL,
  common_input_json TEXT NOT NULL,
  actual_request_json TEXT NOT NULL,
  client_request_text TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE extension_installations (
  extension_id TEXT PRIMARY KEY,
  installed_version TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('BUILT_IN', 'LOCAL', 'MARKETPLACE')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  manifest_hash TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE extension_permission_grants (
  extension_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (extension_id, permission_key),
  FOREIGN KEY (extension_id) REFERENCES extension_installations(extension_id)
);

CREATE TABLE extension_state_events (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'DISCOVERED', 'UPDATED', 'ENABLED', 'DISABLED',
    'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'THREAD_BOUND'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE extension_thread_bindings (
  extension_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('DRAFT', 'SERIES', 'SYSTEM')),
  scope_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  thread_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (extension_id, scope_kind, scope_id),
  UNIQUE (extension_id, thread_id),
  FOREIGN KEY (extension_id) REFERENCES extension_installations(extension_id)
);

CREATE TABLE facet_definitions (
  id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  selection_mode TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  system_role TEXT CHECK (
    system_role IS NULL OR system_role IN ('PRIMARY_CLASSIFICATION', 'SECONDARY_CLASSIFICATION')
  )
);

CREATE TABLE facet_values (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES facet_definitions(id),
  stable_key TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(definition_id, stable_key)
);

CREATE TABLE file_projection_directories (
  projection_key TEXT PRIMARY KEY,
  context_type TEXT NOT NULL CHECK(context_type IN ('ALBUM', 'TERM_DOMAIN', 'TERM_TYPE', 'TERM')),
  context_id TEXT NOT NULL,
  parent_projection_key TEXT,
  relative_path TEXT NOT NULL,
  relative_path_key TEXT NOT NULL,
  previous_relative_path TEXT,
  preferred_name TEXT NOT NULL,
  allocated_name TEXT NOT NULL,
  allocated_name_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED')),
  reserved_until TEXT,
  last_error TEXT,
  verified_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE file_projection_links (
  projection_key TEXT PRIMARY KEY,
  context_type TEXT NOT NULL CHECK(context_type IN ('ALBUM', 'TERM')),
  context_id TEXT NOT NULL,
  directory_projection_key TEXT,
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  relative_path TEXT NOT NULL,
  relative_path_key TEXT NOT NULL,
  previous_relative_path TEXT,
  source_relative_path TEXT NOT NULL,
  source_object_hash TEXT NOT NULL,
  preferred_name TEXT NOT NULL,
  allocated_name TEXT NOT NULL,
  allocated_name_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED')),
  reserved_until TEXT,
  last_error TEXT,
  verified_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generation_edit_specs (
  prompt_version_id TEXT PRIMARY KEY REFERENCES prompt_versions(id) ON DELETE CASCADE,
  source_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  mode TEXT NOT NULL CHECK(mode IN ('SEMANTIC', 'MASK')),
  annotation_snapshot_json TEXT NOT NULL,
  annotation_snapshot_hash TEXT NOT NULL,
  mask_artifact_id TEXT REFERENCES image_edit_artifacts(id),
  rasterizer_version INTEGER NOT NULL CHECK(rasterizer_version >= 1),
  created_at TEXT NOT NULL
);

CREATE TABLE generation_job_links (
  generation_run_id TEXT PRIMARY KEY REFERENCES generation_runs(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES background_jobs(id)
);

CREATE TABLE generation_model_snapshots (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
  model_key TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  descriptor_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE generation_outputs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES background_jobs(id),
  attempt_id TEXT REFERENCES background_job_attempts(id),
  output_slot TEXT NOT NULL,
  image_asset_id TEXT NOT NULL UNIQUE REFERENCES image_assets(id),
  provider_output_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, output_slot)
);

CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  model_key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL,
  result_asset_id TEXT REFERENCES image_assets(id),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
, canvas_preset_key TEXT);

CREATE TABLE historical_term_recommendation_runs (
  id TEXT PRIMARY KEY,
  scope_kind TEXT CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT,
  input_snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  indexed_prompt_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((scope_kind IS NULL AND scope_id IS NULL) OR (scope_kind IS NOT NULL AND scope_id IS NOT NULL))
);

CREATE TABLE image_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  object_hash TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
, deleted_at TEXT);

CREATE TABLE image_edit_artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('MASK', 'ANNOTATION_GUIDE')),
  object_hash TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL CHECK(width > 0),
  height INTEGER NOT NULL CHECK(height > 0),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  created_at TEXT NOT NULL,
  UNIQUE(kind, object_hash)
);

CREATE TABLE image_ratings (
  id TEXT PRIMARY KEY,
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  evaluator_key TEXT NOT NULL DEFAULT 'LOCAL_OWNER',
  dimension TEXT NOT NULL CHECK(dimension IN ('AESTHETIC', 'REALISM')),
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(image_asset_id, evaluator_key, dimension)
);

CREATE TABLE image_transform_runs (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES prompt_series(id),
  source_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  output_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  kind TEXT NOT NULL CHECK(kind IN ('CROP')),
  ratio_width INTEGER NOT NULL CHECK(ratio_width > 0),
  ratio_height INTEGER NOT NULL CHECK(ratio_height > 0),
  crop_x INTEGER NOT NULL CHECK(crop_x >= 0),
  crop_y INTEGER NOT NULL CHECK(crop_y >= 0),
  crop_width INTEGER NOT NULL CHECK(crop_width > 0),
  crop_height INTEGER NOT NULL CHECK(crop_height > 0),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(output_asset_id)
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id),
  row_no INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE knowledge_distillation_acceptances (
  proposal_id TEXT PRIMARY KEY REFERENCES knowledge_distillation_proposals(id),
  palette_id TEXT NOT NULL UNIQUE REFERENCES word_palettes(id),
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  selection_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE knowledge_distillation_proposals (
  id TEXT PRIMARY KEY,
  source_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  source_series_id TEXT NOT NULL REFERENCES prompt_series(id),
  source_prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  status TEXT NOT NULL CHECK (status IN ('READY', 'CLOSED')),
  input_snapshot_json TEXT NOT NULL,
  capability_receipt_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_distillation_term_acceptances (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES knowledge_distillation_proposals(id),
  candidate_id TEXT NOT NULL,
  term_id TEXT NOT NULL REFERENCES terms(id),
  created_at TEXT NOT NULL,
  UNIQUE(proposal_id, candidate_id),
  UNIQUE(proposal_id, term_id)
);

CREATE TABLE local_overrides (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  base_release_item_id TEXT NOT NULL,
  override_kind TEXT NOT NULL CHECK(override_kind IN ('REPLACE', 'HIDE', 'ORDER', 'DEFAULT')),
  local_object_type TEXT NOT NULL DEFAULT '',
  local_revision_id TEXT NOT NULL DEFAULT '',
  local_content_hash TEXT NOT NULL DEFAULT '',
  patch_json TEXT NOT NULL DEFAULT '{}',
  scope_type TEXT NOT NULL CHECK(scope_type IN ('SPACE', 'ALBUM', 'CONVERSATION')),
  scope_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(state IN ('ACTIVE', 'DISABLED', 'CONFLICTED', 'DORMANT', 'SUPERSEDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK(
    (scope_type = 'SPACE' AND scope_id = '')
    OR (scope_type IN ('ALBUM', 'CONVERSATION') AND length(trim(scope_id)) > 0)
  )
);

CREATE TABLE local_spaces (
  id TEXT PRIMARY KEY,
  singleton_key INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK(singleton_key = 1),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'LOCAL' CHECK(mode IN ('LOCAL')),
  compatibility_version INTEGER NOT NULL DEFAULT 1 CHECK(compatibility_version > 0),
  backup_config_json TEXT NOT NULL DEFAULT '{}',
  retention_config_json TEXT NOT NULL DEFAULT '{}',
  sync_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE material_favorites (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('IMAGE', 'TEXT')),
  image_asset_id TEXT REFERENCES image_assets(id),
  text_content TEXT,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK(
    (kind = 'IMAGE' AND image_asset_id IS NOT NULL AND text_content IS NULL) OR
    (kind = 'TEXT' AND image_asset_id IS NULL AND text_content IS NOT NULL)
  )
);

CREATE TABLE pack_dependencies (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  target_pack_id TEXT NOT NULL,
  dependency_kind TEXT NOT NULL
    CHECK(dependency_kind IN ('REQUIRED', 'OPTIONAL', 'RECOMMENDED')),
  version_range TEXT NOT NULL CHECK(length(trim(version_range)) > 0),
  locked_release_id TEXT,
  suggested_roles_json TEXT NOT NULL DEFAULT '[]',
  capability_key TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(release_id, target_pack_id)
);

CREATE TABLE pack_install_attempt_dependencies (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  dependency_id TEXT NOT NULL,
  resolution_kind TEXT NOT NULL CHECK(resolution_kind IN ('LOCKED', 'OMITTED')),
  resolved_release_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(attempt_id, dependency_id),
  CHECK(
    (resolution_kind = 'LOCKED' AND resolved_release_id IS NOT NULL)
    OR (resolution_kind = 'OMITTED' AND resolved_release_id IS NULL)
  )
);

CREATE TABLE pack_install_attempts (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('INSTALL', 'UPGRADE', 'VERIFY', 'REMOVE')),
  target_release_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED')),
  previous_installation_state TEXT
    CHECK(previous_installation_state IS NULL OR previous_installation_state IN
      ('INSTALLING', 'UPDATING', 'INSTALLED', 'DISABLED',
        'FAILED_NO_USABLE_RELEASE', 'REMOVAL_PENDING', 'REMOVED')),
  previous_release_id TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  verification_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE pack_installations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  selected_release_id TEXT,
  state TEXT NOT NULL
    CHECK(state IN (
      'INSTALLING', 'UPDATING', 'INSTALLED', 'DISABLED',
      'FAILED_NO_USABLE_RELEASE', 'REMOVAL_PENDING', 'REMOVED'
    )),
  installation_source_json TEXT NOT NULL DEFAULT '{}',
  installed_at TEXT,
  disabled_at TEXT,
  removal_requested_at TEXT,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(space_id, pack_id),
  UNIQUE(id, space_id, pack_id)
);

CREATE TABLE pack_object_links (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  release_item_id TEXT NOT NULL,
  local_object_type TEXT NOT NULL CHECK(length(trim(local_object_type)) > 0),
  local_object_id TEXT NOT NULL CHECK(length(trim(local_object_id)) > 0),
  local_revision_id TEXT NOT NULL CHECK(length(trim(local_revision_id)) > 0),
  mapping_kind TEXT NOT NULL CHECK(mapping_kind IN
    ('INSTALLED_NEW', 'REUSED_IDENTICAL', 'MANUALLY_MAPPED', 'RETAINED_HISTORY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE pack_release_items (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  item_key TEXT NOT NULL CHECK(length(trim(item_key)) > 0),
  object_type TEXT NOT NULL CHECK(length(trim(object_type)) > 0),
  object_revision_id TEXT NOT NULL CHECK(length(trim(object_revision_id)) > 0),
  content_hash TEXT NOT NULL CHECK(length(trim(content_hash)) > 0),
  inclusion_kind TEXT NOT NULL DEFAULT 'CORE'
    CHECK(inclusion_kind IN ('CORE', 'OPTIONAL', 'EXAMPLE')),
  visibility TEXT NOT NULL DEFAULT 'VISIBLE'
    CHECK(visibility IN ('VISIBLE', 'HIDDEN', 'INTERNAL')),
  rights_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(release_id, item_key)
);

CREATE TABLE pack_releases (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  version TEXT NOT NULL CHECK(length(trim(version)) > 0),
  manifest_version INTEGER NOT NULL CHECK(manifest_version > 0),
  content_hash TEXT NOT NULL CHECK(length(trim(content_hash)) > 0),
  manifest_json TEXT NOT NULL,
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  default_roles_json TEXT NOT NULL DEFAULT '[]',
  license_summary TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  UNIQUE(pack_id, version),
  UNIQUE(id, pack_id)
);

CREATE TABLE packs (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('CONTENT', 'BUNDLE')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  content_kinds_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE prompt_history_documents (
  prompt_version_id TEXT PRIMARY KEY REFERENCES prompt_versions(id),
  user_prompt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  source_created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE prompt_history_term_uses (
  prompt_version_id TEXT NOT NULL REFERENCES prompt_history_documents(prompt_version_id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES terms(id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('DIRECT_TERM', 'RECIPE_TERM')),
  PRIMARY KEY(prompt_version_id, term_id)
);

CREATE TABLE prompt_history_tokens (
  prompt_version_id TEXT NOT NULL REFERENCES prompt_history_documents(prompt_version_id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  term_frequency INTEGER NOT NULL CHECK(term_frequency > 0),
  PRIMARY KEY(prompt_version_id, token)
);

CREATE TABLE prompt_input_snapshots (
  id TEXT PRIMARY KEY,
  prompt_version_id TEXT NOT NULL UNIQUE REFERENCES prompt_versions(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('COMPOSED', 'FLAT_INPUT')),
  user_instruction TEXT NOT NULL,
  common_input_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE prompt_palette_bindings (
  id TEXT PRIMARY KEY,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  palette_id TEXT NOT NULL REFERENCES word_palettes(id),
  parameter_values_json TEXT NOT NULL, prompt_locale TEXT NOT NULL DEFAULT 'en', sort_order INTEGER NOT NULL DEFAULT 0, palette_revision_id TEXT REFERENCES word_palette_revisions(id),
  UNIQUE(prompt_version_id, palette_id)
);

CREATE TABLE prompt_series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
, title_zh TEXT, title_en TEXT);

CREATE TABLE prompt_term_bindings (
  id TEXT PRIMARY KEY,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  term_id TEXT NOT NULL REFERENCES terms(id), sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(prompt_version_id, term_id)
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES prompt_series(id),
  parent_version_id TEXT REFERENCES prompt_versions(id),
  version_no INTEGER NOT NULL,
  user_intent TEXT NOT NULL,
  final_prompt TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  source_image_id TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, composition_mode TEXT NOT NULL DEFAULT 'FLATTENED', term_prompt_locale TEXT NOT NULL DEFAULT 'en'
  CHECK (term_prompt_locale IN ('zh', 'en')), origin_type TEXT NOT NULL DEFAULT 'INTERNAL_CREATION'
  CHECK(origin_type IN ('INTERNAL_CREATION', 'EXTERNAL_IMPORT', 'MANUAL_PROMPT')), prompt_knowledge TEXT NOT NULL DEFAULT 'EXACT'
  CHECK(prompt_knowledge IN ('UNKNOWN', 'EXACT')),
  UNIQUE(series_id, version_no)
);

CREATE TABLE provider_returned_descriptions (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL REFERENCES generation_runs(id),
  field_name TEXT NOT NULL CHECK(length(trim(field_name)) > 0),
  raw_value TEXT NOT NULL,
  interpretation TEXT,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('RUN', 'OUTPUT')),
  output_ordinal INTEGER NOT NULL DEFAULT -1,
  content_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  CHECK(
    (scope_kind = 'RUN' AND output_ordinal = -1)
    OR (scope_kind = 'OUTPUT' AND output_ordinal >= 0)
  ),
  UNIQUE(generation_run_id, field_name, output_ordinal, content_hash)
);

CREATE TABLE reference_bindings (
  id TEXT PRIMARY KEY,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  sort_order INTEGER NOT NULL
, source_type TEXT NOT NULL DEFAULT 'DIRECT', source_palette_revision_id TEXT REFERENCES word_palette_revisions(id));

CREATE TABLE style_exploration_batches (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('DRAFT', 'SERIES')),
  scope_id TEXT NOT NULL CHECK(length(trim(scope_id)) > 0),
  source_assistant_run_id TEXT NOT NULL REFERENCES assistant_runs(id),
  common_constraints_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE style_exploration_slot_runs (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES style_exploration_slots(id) ON DELETE CASCADE,
  generation_run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(slot_id, sort_order)
);

CREATE TABLE style_exploration_slots (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES style_exploration_batches(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  label TEXT NOT NULL CHECK(length(trim(label)) > 0),
  rationale TEXT NOT NULL,
  variable_axis TEXT NOT NULL,
  risk TEXT NOT NULL,
  user_instruction TEXT NOT NULL,
  series_id TEXT NOT NULL REFERENCES prompt_series(id),
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
  UNIQUE(batch_id, sort_order)
);

CREATE TABLE term_directory_placements (
  term_id TEXT PRIMARY KEY REFERENCES terms(id),
  domain_facet_value_id TEXT REFERENCES facet_values(id) ON DELETE SET NULL,
  item_type_facet_value_id TEXT REFERENCES facet_values(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, primary_category_id TEXT REFERENCES term_categories(id));

CREATE TABLE term_evidence (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  image_asset_id TEXT REFERENCES image_assets(id),
  verdict TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE term_media_links (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  role TEXT NOT NULL CHECK (role IN ('COVER', 'RELATED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  focal_x REAL NOT NULL DEFAULT 0.5 CHECK (focal_x >= 0 AND focal_x <= 1),
  focal_y REAL NOT NULL DEFAULT 0.5 CHECK (focal_y >= 0 AND focal_y <= 1),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE terms (
  id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL UNIQUE,
  current_revision_id TEXT,
  editorial_state TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE tombstones (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'LOCAL_ONLY'
);

CREATE TABLE web_resources (
  id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  summary_en TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'INSPIRATION', 'DESIGN_SYSTEM', 'ICONS', 'TYPOGRAPHY', 'COLOR',
    'MEDIA', 'OPTIMIZATION', 'MOTION', 'ACCESSIBILITY', 'QUALITY'
  )),
  resource_kind TEXT NOT NULL CHECK(resource_kind IN (
    'REFERENCE_SITE', 'ASSET_SOURCE', 'IMPLEMENTATION_REFERENCE', 'VALIDATION_TOOL'
  )),
  url TEXT NOT NULL,
  license_url TEXT,
  use_case_zh TEXT NOT NULL,
  use_case_en TEXT NOT NULL,
  license_note_zh TEXT NOT NULL,
  license_note_en TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  collected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE word_palette_revision_media (
  id TEXT PRIMARY KEY,
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  sort_order INTEGER NOT NULL,
  UNIQUE(palette_revision_id, image_asset_id)
);

CREATE TABLE word_palette_revision_terms (
  id TEXT PRIMARY KEY,
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  term_id TEXT NOT NULL REFERENCES terms(id),
  sort_order INTEGER NOT NULL,
  UNIQUE(palette_revision_id, term_id)
);

CREATE TABLE word_palette_revision_content_nodes (
  id TEXT PRIMARY KEY,
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  kind TEXT NOT NULL CHECK(kind IN ('TEXT', 'TERM', 'SLOT')),
  term_id TEXT REFERENCES terms(id),
  parameter_revision_id TEXT REFERENCES word_palette_revision_parameters(id),
  prompt_fragment TEXT NOT NULL DEFAULT '',
  negative_fragment TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  UNIQUE(palette_revision_id, sort_order),
  CHECK(
    (kind = 'TEXT' AND term_id IS NULL AND parameter_revision_id IS NULL)
    OR (kind = 'TERM' AND term_id IS NOT NULL AND parameter_revision_id IS NULL)
    OR (kind = 'SLOT' AND term_id IS NULL AND parameter_revision_id IS NOT NULL)
  )
);

CREATE TABLE word_palette_revision_option_contents (
  id TEXT PRIMARY KEY,
  option_id TEXT NOT NULL REFERENCES word_palette_revision_parameter_options(id),
  kind TEXT NOT NULL CHECK(kind IN ('TEXT', 'TERM')),
  term_id TEXT REFERENCES terms(id),
  prompt_fragment TEXT NOT NULL DEFAULT '',
  negative_fragment TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  UNIQUE(option_id, sort_order),
  CHECK(
    (kind = 'TEXT' AND term_id IS NULL)
    OR (kind = 'TERM' AND term_id IS NOT NULL)
  )
);

CREATE TABLE creations (
  id TEXT PRIMARY KEY,
  source_scope_kind TEXT NOT NULL CHECK(source_scope_kind IN ('DRAFT', 'SERIES')),
  source_scope_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  brief_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('FORMING', 'ACTIVE', 'FAILED', 'ARCHIVED')),
  failure_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT
, context_key TEXT NOT NULL DEFAULT '');

CREATE TABLE creation_elements (
  id TEXT PRIMARY KEY,
  creation_id TEXT NOT NULL REFERENCES creations(id),
  kind TEXT NOT NULL CHECK(kind IN (
    'BRIEF',
    'ASSISTANT_RUN',
    'DIRECTION_SET',
    'PROMPT_SERIES',
    'DOCUMENT',
    'MATERIAL',
    'STYLE_EXPLORATION_BATCH',
    'COMPARISON_SET'
  )),
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(creation_id, kind, target_id)
);

CREATE TABLE creation_activity_events (
  id TEXT PRIMARY KEY,
  creation_id TEXT NOT NULL REFERENCES creations(id),
  assistant_run_id TEXT REFERENCES assistant_runs(id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  phase TEXT NOT NULL CHECK(phase IN (
    'CREATION_SAVED',
    'MODEL_REQUESTED',
    'MODEL_RESPONDING',
    'RESULT_VALIDATED',
    'COMPLETED',
    'FAILED',
    'INTERRUPTED'
  )),
  provider_key TEXT,
  model_key TEXT,
  message TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(creation_id, sequence)
);

CREATE TABLE "word_palettes" (
  id TEXT PRIMARY KEY,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  current_revision_id TEXT REFERENCES word_palette_revisions(id)
);

CREATE TABLE generation_output_reviews (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL UNIQUE,
  disposition TEXT NOT NULL CHECK(disposition IN ('VISIBLE', 'FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sidebar_root_order (
  scope TEXT NOT NULL CHECK(scope IN ('CREATOR', 'GALLERY')),
  target_type TEXT NOT NULL CHECK(target_type IN ('ALBUM', 'SERIES')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, target_type, target_id)
);

CREATE TABLE external_material_metadata (
  material_id TEXT PRIMARY KEY REFERENCES materials(id),
  original_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ai_generated_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(ai_generated_status IN ('YES', 'NO', 'UNKNOWN', 'OTHER')),
  model_key TEXT,
  model_name TEXT NOT NULL DEFAULT '',
  model_provider TEXT NOT NULL DEFAULT '',
  model_version TEXT NOT NULL DEFAULT '',
  generation_text_type TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(generation_text_type IN ('EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN')),
  generation_text TEXT NOT NULL DEFAULT '',
  provenance_confidence TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(provenance_confidence IN ('DECLARED', 'UNKNOWN')),
  updated_at TEXT NOT NULL
);

CREATE TABLE "creation_output_imports" (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  series_id TEXT NOT NULL REFERENCES prompt_series(id),
  prompt_version_id TEXT REFERENCES prompt_versions(id),
  image_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('PASTE', 'DROP', 'UPLOAD')),
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  display_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  ai_generated_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(ai_generated_status IN ('YES', 'NO', 'UNKNOWN', 'OTHER')),
  model_key TEXT,
  model_name TEXT NOT NULL DEFAULT '',
  model_provider TEXT NOT NULL DEFAULT '',
  model_version TEXT NOT NULL DEFAULT '',
  generation_text_type TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(generation_text_type IN ('EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN')),
  generation_text TEXT NOT NULL DEFAULT '',
  provenance_confidence TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(provenance_confidence IN ('VERIFIED', 'DECLARED', 'INFERRED', 'UNKNOWN')),
  comparison_role TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(comparison_role IN ('MODEL', 'UNKNOWN', 'ACTUAL'))
, codex_thread_id TEXT, codex_thread_name TEXT NOT NULL DEFAULT '');

CREATE TABLE term_categories (
  id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL UNIQUE,
  primary_facet_value_id TEXT NOT NULL REFERENCES facet_values(id),
  secondary_facet_value_id TEXT REFERENCES facet_values(id), parent_id TEXT REFERENCES term_categories(id), sort_order INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK(state IN ('ACTIVE', 'DISABLED')), source_type TEXT NOT NULL DEFAULT 'CONTENT_PACK'
  CHECK(source_type IN ('CONTENT_PACK', 'LOCAL')), modified_locally INTEGER NOT NULL DEFAULT 0
  CHECK(modified_locally IN (0, 1)), created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', name_locale TEXT NOT NULL DEFAULT 'en',
  UNIQUE(primary_facet_value_id, secondary_facet_value_id)
);

CREATE TABLE term_revisions (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  revision_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_locale TEXT NOT NULL CHECK(length(trim(title_locale)) > 0),
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(term_id, revision_no)
);

CREATE TABLE term_localizations (
  id TEXT PRIMARY KEY,
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  locale TEXT NOT NULL CHECK(length(trim(locale)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  definition TEXT NOT NULL,
  UNIQUE(term_revision_id, locale)
);

CREATE TABLE term_aliases (
  id TEXT PRIMARY KEY,
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  locale TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL
);

CREATE TABLE term_facet_assignments (
  id TEXT PRIMARY KEY,
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  facet_value_id TEXT NOT NULL REFERENCES facet_values(id),
  UNIQUE(term_revision_id, facet_value_id)
);

CREATE VIRTUAL TABLE term_search_fts USING fts5(
  term_id UNINDEXED,
  title,
  definition,
  aliases,
  expressions
);

CREATE TABLE term_category_localizations (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES term_categories(id),
  locale TEXT NOT NULL CHECK(length(trim(locale)) > 0),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  UNIQUE(category_id, locale)
);

CREATE TABLE term_revision_categories (
  id TEXT PRIMARY KEY,
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  category_id TEXT NOT NULL REFERENCES term_categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  UNIQUE(term_revision_id, category_id),
  UNIQUE(term_revision_id, sort_order)
);

CREATE TABLE term_context_profiles (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  stable_key TEXT NOT NULL CHECK(length(trim(stable_key)) > 0),
  created_at TEXT NOT NULL,
  UNIQUE(term_id, stable_key)
);

CREATE TABLE term_context_profile_revisions (
  id TEXT PRIMARY KEY,
  context_profile_id TEXT NOT NULL REFERENCES term_context_profiles(id),
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  definition TEXT NOT NULL DEFAULT '',
  exclusion_boundary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(context_profile_id, term_revision_id)
);

CREATE TABLE term_expressions (
  id TEXT PRIMARY KEY,
  term_revision_id TEXT NOT NULL REFERENCES term_revisions(id),
  context_profile_revision_id TEXT NOT NULL REFERENCES term_context_profile_revisions(id),
  model_key TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(length(trim(locale)) > 0),
  positive_expression TEXT NOT NULL,
  negative_expression TEXT NOT NULL,
  UNIQUE(term_revision_id, context_profile_revision_id, model_key, locale)
);

CREATE TABLE "word_palette_revisions" (
  id TEXT PRIMARY KEY,
  palette_id TEXT NOT NULL REFERENCES word_palettes(id),
  parent_revision_id TEXT REFERENCES word_palette_revisions(id),
  revision_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_locale TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('STATIC', 'PARAMETERIZED')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(palette_id, revision_no)
);

CREATE TABLE "word_palette_revision_parameters" (
  id TEXT PRIMARY KEY,
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  stable_key TEXT NOT NULL,
  name TEXT NOT NULL,
  name_locale TEXT NOT NULL,
  required INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(palette_revision_id, stable_key)
);

CREATE TABLE "word_palette_revision_parameter_options" (
  id TEXT PRIMARY KEY,
  parameter_revision_id TEXT NOT NULL REFERENCES word_palette_revision_parameters(id),
  value_key TEXT NOT NULL,
  label TEXT NOT NULL,
  label_locale TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(parameter_revision_id, value_key)
);

CREATE TABLE word_palette_revision_localizations (
  id TEXT PRIMARY KEY,
  palette_revision_id TEXT NOT NULL REFERENCES word_palette_revisions(id),
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  UNIQUE(palette_revision_id, locale)
);

CREATE TABLE word_palette_revision_parameter_localizations (
  id TEXT PRIMARY KEY,
  parameter_revision_id TEXT NOT NULL REFERENCES word_palette_revision_parameters(id),
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(parameter_revision_id, locale)
);

CREATE TABLE word_palette_revision_option_localizations (
  id TEXT PRIMARY KEY,
  option_id TEXT NOT NULL REFERENCES word_palette_revision_parameter_options(id),
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE(option_id, locale)
);

INSERT INTO app_meta(key, value) VALUES ('product_data_baseline', '0.3.0');
INSERT INTO app_meta(key, value) VALUES ('database_schema_revision', '1');

INSERT INTO local_spaces(
  id, singleton_key, name, description, mode, compatibility_version,
  backup_config_json, retention_config_json, sync_config_json, created_at, updated_at
)
SELECT
  'space_' || lower(hex(randomblob(16))), 1, 'Local Space', '', 'LOCAL', 1,
  '{}', '{}', '{}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO app_meta(key, value) SELECT 'local_space_id', id FROM local_spaces WHERE singleton_key = 1;

CREATE UNIQUE INDEX idx_album_members_active_child_owner
ON album_members(target_id)
WHERE target_type = 'ALBUM' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_active_order
ON album_members(album_id, target_type, sort_order, id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_album_members_active_series_owner
ON album_members(target_id)
WHERE target_type = 'SERIES' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_reverse
ON album_members(target_type, target_id, album_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_albums_active_all
ON albums(updated_at DESC, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_albums_active_content_activity
ON albums(pinned DESC, content_updated_at DESC, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_albums_active_intent
ON albums(intent, created_at, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_albums_active_pinned
ON albums(pinned DESC, updated_at DESC, id)
WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX idx_annotations_asset ON annotations(image_asset_id);

CREATE INDEX idx_asset_derivations_child
  ON asset_derivations(child_asset_id, created_at);

CREATE INDEX idx_asset_derivations_source
  ON asset_derivations(source_asset_id, created_at);

CREATE INDEX idx_assignments_revision ON term_facet_assignments(term_revision_id);

CREATE INDEX idx_assignments_value ON term_facet_assignments(facet_value_id);

CREATE INDEX idx_assistant_proposals_status
ON assistant_proposals(status, updated_at DESC, id DESC);

CREATE INDEX idx_assistant_runs_scope
ON assistant_runs(scope_kind, scope_id, created_at DESC, id DESC);

CREATE INDEX idx_assistant_runs_status
ON assistant_runs(status, created_at, id);

CREATE INDEX idx_background_job_attempts_job
  ON background_job_attempts(job_id, attempt_no DESC);

CREATE INDEX idx_background_job_attempts_lease
  ON background_job_attempts(status, lease_expires_at, job_id);

CREATE UNIQUE INDEX idx_background_job_attempts_provider_request
  ON background_job_attempts(provider_key, provider_request_id)
  WHERE provider_key IS NOT NULL AND provider_request_id IS NOT NULL;

CREATE INDEX idx_background_job_events_job
  ON background_job_events(job_id, sequence);

CREATE INDEX idx_background_jobs_retry
  ON background_jobs(retry_of_job_id, created_at, id);

CREATE INDEX idx_background_jobs_schedule
  ON background_jobs(kind, desired_state, status, priority DESC, not_before, created_at, id);

CREATE INDEX idx_codex_image_discoveries_recent
ON codex_image_discoveries(missing_at, file_modified_at DESC, id DESC);

CREATE INDEX idx_codex_image_discoveries_thread
ON codex_image_discoveries(thread_id, missing_at, file_modified_at DESC);

CREATE INDEX idx_codex_image_discovery_events_item
ON codex_image_discovery_events(discovery_id, created_at DESC);

CREATE UNIQUE INDEX idx_context_pack_activations_active_identity
ON context_pack_activations(space_id, target_type, target_id, pack_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_context_pack_activations_target
ON context_pack_activations(space_id, target_type, target_id, priority, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_activity_events_assistant_run
ON creation_activity_events(assistant_run_id, sequence)
WHERE assistant_run_id IS NOT NULL;

CREATE INDEX idx_creation_activity_events_creation
ON creation_activity_events(creation_id, sequence);

CREATE INDEX idx_creation_draft_materials_order
ON creation_draft_materials(creation_draft_id, sort_order);

CREATE INDEX idx_creation_drafts_active
ON creation_drafts(updated_at DESC)
WHERE consumed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_creation_drafts_album_active
ON creation_drafts(target_album_id, updated_at DESC)
WHERE consumed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_creation_elements_creation
ON creation_elements(creation_id, sort_order, created_at, id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_elements_target
ON creation_elements(kind, target_id, creation_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_input_stashes_scope
ON creation_input_stashes(scope_kind, scope_id, revision_no DESC);

CREATE INDEX idx_creation_output_imports_asset
ON creation_output_imports(image_asset_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_output_imports_batch
ON creation_output_imports(batch_id, created_at, id);

CREATE INDEX idx_creation_output_imports_model_name
ON creation_output_imports(model_name)
WHERE deleted_at IS NULL AND model_name <> '';

CREATE INDEX idx_creation_output_imports_model_provider
ON creation_output_imports(model_provider)
WHERE deleted_at IS NULL AND model_provider <> '';

CREATE INDEX idx_creation_output_imports_series
ON creation_output_imports(series_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_output_imports_version
ON creation_output_imports(prompt_version_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creations_active_updated
ON creations(status, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_creations_live_source
ON creations(source_scope_kind, source_scope_id)
WHERE deleted_at IS NULL AND status <> 'ARCHIVED';

CREATE INDEX idx_creator_agent_turns_scope
ON creator_agent_turns(scope_kind, scope_id, created_at, id);

CREATE INDEX idx_dictionary_maintenance_reports_created
ON dictionary_maintenance_reports(created_at DESC, id DESC);

CREATE INDEX idx_direction_experiment_director_tasks_assistant_run
ON direction_experiment_director_tasks(source_assistant_run_id, created_at DESC, id DESC);

CREATE INDEX idx_direction_experiment_director_tasks_scope
ON direction_experiment_director_tasks(scope_kind, scope_id, created_at DESC, id DESC);

CREATE INDEX idx_execution_input_snapshots_run
  ON execution_input_snapshots(generation_run_id);

CREATE INDEX idx_extension_state_events_extension
  ON extension_state_events(extension_id, created_at DESC);

CREATE INDEX idx_external_material_metadata_display_name
ON external_material_metadata(display_name);

CREATE INDEX idx_external_material_metadata_model_name
ON external_material_metadata(model_name)
WHERE model_name <> '';

CREATE INDEX idx_external_material_metadata_model_provider
ON external_material_metadata(model_provider)
WHERE model_provider <> '';

CREATE UNIQUE INDEX idx_facet_definitions_system_role
ON facet_definitions(system_role)
WHERE system_role IS NOT NULL;

CREATE UNIQUE INDEX idx_file_projection_directory_context_active
ON file_projection_directories(context_type, context_id)
WHERE state <> 'RETIRED';

CREATE UNIQUE INDEX idx_file_projection_directory_path_active
ON file_projection_directories(relative_path_key)
WHERE state <> 'RETIRED';

CREATE INDEX idx_file_projection_link_asset
ON file_projection_links(image_asset_id, context_type, context_id);

CREATE UNIQUE INDEX idx_file_projection_link_context_active
ON file_projection_links(context_type, context_id, image_asset_id)
WHERE state <> 'RETIRED';

CREATE UNIQUE INDEX idx_file_projection_link_path_active
ON file_projection_links(relative_path_key)
WHERE state <> 'RETIRED';

CREATE INDEX idx_generation_edit_specs_source
ON generation_edit_specs(source_asset_id, created_at DESC);

CREATE INDEX idx_generation_output_reviews_disposition
  ON generation_output_reviews(disposition, updated_at DESC);

CREATE INDEX idx_generation_outputs_job
  ON generation_outputs(job_id, output_slot);

CREATE INDEX idx_generation_runs_result_asset
  ON generation_runs(result_asset_id, status, created_at DESC)
  WHERE result_asset_id IS NOT NULL;

CREATE INDEX idx_historical_term_recommendation_scope
ON historical_term_recommendation_runs(scope_kind, scope_id, created_at DESC);

CREATE INDEX idx_image_assets_active
ON image_assets(deleted_at, created_at);

CREATE INDEX idx_image_assets_gallery_order
  ON image_assets(created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_image_ratings_asset
  ON image_ratings(image_asset_id, evaluator_key, dimension, deleted_at);

CREATE INDEX idx_image_transform_runs_series
ON image_transform_runs(series_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_image_transform_runs_source
ON image_transform_runs(source_asset_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_knowledge_distillation_acceptance_palette
ON knowledge_distillation_acceptances(palette_id);

CREATE INDEX idx_knowledge_distillation_prompt_version
ON knowledge_distillation_proposals(source_prompt_version_id, created_at DESC);

CREATE INDEX idx_knowledge_distillation_source
ON knowledge_distillation_proposals(source_asset_id, created_at DESC);

CREATE INDEX idx_knowledge_distillation_term_acceptance_proposal
ON knowledge_distillation_term_acceptances(proposal_id);

CREATE UNIQUE INDEX idx_local_overrides_active_identity
ON local_overrides(space_id, base_release_item_id, override_kind, scope_type, scope_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_local_overrides_base_item
ON local_overrides(space_id, base_release_item_id, state)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_material_favorites_active
ON material_favorites(material_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_materials_active_content
ON materials(kind, content_hash, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_materials_active_image
ON materials(image_asset_id)
WHERE image_asset_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_pack_dependencies_target
ON pack_dependencies(target_pack_id, release_id);

CREATE INDEX idx_pack_install_attempts_history
ON pack_install_attempts(installation_id, started_at, id);

CREATE UNIQUE INDEX idx_pack_install_attempts_one_running
ON pack_install_attempts(installation_id)
WHERE status = 'RUNNING';

CREATE INDEX idx_pack_installations_active_state
ON pack_installations(space_id, state, pack_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_pack_object_links_active_identity
ON pack_object_links(space_id, release_item_id, local_object_type, local_revision_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_pack_release_items_object_revision
ON pack_release_items(object_type, object_revision_id, release_id);

CREATE INDEX idx_pack_releases_pack_order
ON pack_releases(pack_id, created_at, id);

CREATE INDEX idx_palette_content_nodes_revision
ON word_palette_revision_content_nodes(palette_revision_id, sort_order);

CREATE INDEX idx_palette_content_nodes_term
ON word_palette_revision_content_nodes(term_id)
WHERE term_id IS NOT NULL;

CREATE INDEX idx_palette_option_contents_option
ON word_palette_revision_option_contents(option_id, sort_order);

CREATE INDEX idx_palette_option_contents_term
ON word_palette_revision_option_contents(term_id)
WHERE term_id IS NOT NULL;

CREATE INDEX idx_palette_option_localizations_locale
ON word_palette_revision_option_localizations(locale, label);

CREATE INDEX idx_palette_parameter_localizations_locale
ON word_palette_revision_parameter_localizations(locale, name);

CREATE INDEX idx_palette_revision_localizations_locale
ON word_palette_revision_localizations(locale, name);

CREATE INDEX idx_palette_revision_media_revision
ON word_palette_revision_media(palette_revision_id, sort_order);

CREATE INDEX idx_palette_revision_parameters_revision
ON word_palette_revision_parameters(palette_revision_id, sort_order);

CREATE INDEX idx_palette_revision_terms_revision
ON word_palette_revision_terms(palette_revision_id, sort_order);

CREATE INDEX idx_palette_revisions_palette
ON word_palette_revisions(palette_id, revision_no DESC);

CREATE INDEX idx_prompt_history_term_uses_term
ON prompt_history_term_uses(term_id, prompt_version_id);

CREATE INDEX idx_prompt_history_tokens_token
ON prompt_history_tokens(token, prompt_version_id);

CREATE INDEX idx_prompt_input_snapshots_version
  ON prompt_input_snapshots(prompt_version_id);

CREATE INDEX idx_prompt_palette_bindings_palette_version
  ON prompt_palette_bindings(palette_id, prompt_version_id);

CREATE INDEX idx_prompt_palette_revision
ON prompt_palette_bindings(palette_revision_id);

CREATE INDEX idx_prompt_palette_version ON prompt_palette_bindings(prompt_version_id);

CREATE INDEX idx_prompt_term_bindings_term_version
  ON prompt_term_bindings(term_id, prompt_version_id);

CREATE INDEX idx_prompt_versions_series ON prompt_versions(series_id, version_no DESC);

CREATE INDEX idx_provider_returned_descriptions_run
  ON provider_returned_descriptions(generation_run_id, received_at, id);

CREATE INDEX idx_reference_bindings_source
ON reference_bindings(prompt_version_id, source_type, sort_order);

CREATE INDEX idx_runs_version ON generation_runs(prompt_version_id, created_at DESC);

CREATE INDEX idx_sidebar_root_order_sort
  ON sidebar_root_order(scope, sort_order, target_type, target_id);

CREATE INDEX idx_style_exploration_batches_assistant_run
ON style_exploration_batches(source_assistant_run_id, created_at DESC, id DESC);

CREATE INDEX idx_style_exploration_batches_scope
ON style_exploration_batches(scope_kind, scope_id, created_at DESC, id DESC);

CREATE INDEX idx_style_exploration_slot_runs_slot
ON style_exploration_slot_runs(slot_id, sort_order, id);

CREATE INDEX idx_style_exploration_slots_batch
ON style_exploration_slots(batch_id, sort_order, id);

CREATE INDEX idx_term_aliases_revision_value
  ON term_aliases(term_revision_id, normalized_value, id);

CREATE INDEX idx_term_categories_parent_sort
ON term_categories(parent_id, sort_order, id);

CREATE INDEX idx_term_categories_primary_secondary
  ON term_categories(primary_facet_value_id, secondary_facet_value_id, id);

CREATE INDEX idx_term_categories_state
ON term_categories(state, parent_id, sort_order);

CREATE INDEX idx_term_category_localizations_locale_name
  ON term_category_localizations(locale, name COLLATE NOCASE, category_id);

CREATE INDEX idx_term_context_profile_revisions_term_revision
  ON term_context_profile_revisions(term_revision_id, context_profile_id, id);

CREATE INDEX idx_term_context_profiles_term
  ON term_context_profiles(term_id, stable_key, id);

CREATE INDEX idx_term_directory_placements_primary_category
  ON term_directory_placements(primary_category_id, term_id);

CREATE INDEX idx_term_evidence_term_created
  ON term_evidence(term_id, created_at DESC);

CREATE INDEX idx_term_expressions_revision_context_model
  ON term_expressions(term_revision_id, context_profile_revision_id, model_key, locale, id);

CREATE INDEX idx_term_expressions_revision_model
  ON term_expressions(term_revision_id, model_key, locale, id);

CREATE INDEX idx_term_localizations_revision_locale
  ON term_localizations(term_revision_id, locale, id);

CREATE UNIQUE INDEX idx_term_media_active_asset
ON term_media_links(term_id, image_asset_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_term_media_active_cover
ON term_media_links(term_id)
WHERE role = 'COVER' AND deleted_at IS NULL;

CREATE INDEX idx_term_media_asset
  ON term_media_links(image_asset_id, deleted_at, created_at DESC);

CREATE INDEX idx_term_media_term_order
ON term_media_links(term_id, deleted_at, role, sort_order);

CREATE INDEX idx_term_revision_categories_category_revision
  ON term_revision_categories(category_id, term_revision_id);

CREATE INDEX idx_web_resources_category
  ON web_resources(category, archived_at, name_en);

CREATE INDEX idx_web_resources_kind
  ON web_resources(resource_kind, archived_at, name_en);

CREATE TRIGGER background_job_events_no_delete
BEFORE DELETE ON background_job_events
BEGIN
  SELECT RAISE(ABORT, 'Background job events are immutable');
END;

CREATE TRIGGER background_job_events_no_update
BEFORE UPDATE ON background_job_events
BEGIN
  SELECT RAISE(ABORT, 'Background job events are immutable');
END;

CREATE TRIGGER codex_image_discovery_events_no_delete
BEFORE DELETE ON codex_image_discovery_events
BEGIN
  SELECT RAISE(ABORT, 'Codex image discovery events are immutable');
END;

CREATE TRIGGER codex_image_discovery_events_no_update
BEFORE UPDATE ON codex_image_discovery_events
BEGIN
  SELECT RAISE(ABORT, 'Codex image discovery events are immutable');
END;

CREATE TRIGGER dictionary_maintenance_reports_no_delete
BEFORE DELETE ON dictionary_maintenance_reports
BEGIN
  SELECT RAISE(ABORT, 'Dictionary maintenance reports are immutable');
END;

CREATE TRIGGER dictionary_maintenance_reports_no_update
BEFORE UPDATE ON dictionary_maintenance_reports
BEGIN
  SELECT RAISE(ABORT, 'Dictionary maintenance reports are immutable');
END;

CREATE TRIGGER execution_input_snapshots_no_delete
BEFORE DELETE ON execution_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Execution input snapshots are immutable');
END;

CREATE TRIGGER execution_input_snapshots_no_update
BEFORE UPDATE ON execution_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Execution input snapshots are immutable');
END;

CREATE TRIGGER extension_state_events_no_delete
BEFORE DELETE ON extension_state_events
BEGIN
  SELECT RAISE(ABORT, 'Extension state events are immutable');
END;

CREATE TRIGGER extension_state_events_no_update
BEFORE UPDATE ON extension_state_events
BEGIN
  SELECT RAISE(ABORT, 'Extension state events are immutable');
END;

CREATE TRIGGER generation_model_snapshots_no_delete
BEFORE DELETE ON generation_model_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Generation model snapshots are immutable');
END;

CREATE TRIGGER generation_model_snapshots_no_update
BEFORE UPDATE ON generation_model_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Generation model snapshots are immutable');
END;

CREATE TRIGGER pack_dependencies_insert_before_seal
BEFORE INSERT ON pack_dependencies
WHEN (SELECT sealed_at FROM pack_releases WHERE id = NEW.release_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'pack dependency baseline is sealed');
END;

CREATE TRIGGER pack_dependencies_no_delete
BEFORE DELETE ON pack_dependencies
BEGIN
  SELECT RAISE(ABORT, 'pack dependency is immutable');
END;

CREATE TRIGGER pack_dependencies_no_update
BEFORE UPDATE ON pack_dependencies
BEGIN
  SELECT RAISE(ABORT, 'pack dependency is immutable');
END;

CREATE TRIGGER pack_install_attempt_dependencies_no_delete
BEFORE DELETE ON pack_install_attempt_dependencies
BEGIN
  SELECT RAISE(ABORT, 'installation dependency lock is immutable');
END;

CREATE TRIGGER pack_install_attempt_dependencies_no_update
BEFORE UPDATE ON pack_install_attempt_dependencies
BEGIN
  SELECT RAISE(ABORT, 'installation dependency lock is immutable');
END;

CREATE TRIGGER pack_install_attempt_dependencies_only_while_running
BEFORE INSERT ON pack_install_attempt_dependencies
WHEN (SELECT status FROM pack_install_attempts WHERE id = NEW.attempt_id) <> 'RUNNING'
BEGIN
  SELECT RAISE(ABORT, 'installation attempt is no longer writable');
END;

CREATE TRIGGER pack_release_items_insert_before_seal
BEFORE INSERT ON pack_release_items
WHEN (SELECT sealed_at FROM pack_releases WHERE id = NEW.release_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'pack release item baseline is sealed');
END;

CREATE TRIGGER pack_release_items_no_delete
BEFORE DELETE ON pack_release_items
BEGIN
  SELECT RAISE(ABORT, 'pack release item is immutable');
END;

CREATE TRIGGER pack_release_items_no_update
BEFORE UPDATE ON pack_release_items
BEGIN
  SELECT RAISE(ABORT, 'pack release item is immutable');
END;

CREATE TRIGGER pack_releases_no_delete
BEFORE DELETE ON pack_releases
BEGIN
  SELECT RAISE(ABORT, 'pack release is immutable');
END;

CREATE TRIGGER pack_releases_only_seal
BEFORE UPDATE ON pack_releases
WHEN NOT (
  OLD.sealed_at IS NULL
  AND NEW.sealed_at IS NOT NULL
  AND NEW.id IS OLD.id
  AND NEW.pack_id IS OLD.pack_id
  AND NEW.version IS OLD.version
  AND NEW.manifest_version IS OLD.manifest_version
  AND NEW.content_hash IS OLD.content_hash
  AND NEW.manifest_json IS OLD.manifest_json
  AND NEW.compatibility_json IS OLD.compatibility_json
  AND NEW.default_roles_json IS OLD.default_roles_json
  AND NEW.license_summary IS OLD.license_summary
  AND NEW.provenance_json IS OLD.provenance_json
  AND NEW.published_at IS OLD.published_at
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'pack release is immutable');
END;

CREATE TRIGGER packs_immutable_identity
BEFORE UPDATE OF id, kind ON packs
BEGIN
  SELECT RAISE(ABORT, 'pack identity and kind are immutable');
END;

CREATE TRIGGER prompt_input_snapshots_no_delete
BEFORE DELETE ON prompt_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Prompt input snapshots are immutable');
END;

CREATE TRIGGER prompt_input_snapshots_no_update
BEFORE UPDATE ON prompt_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Prompt input snapshots are immutable');
END;

CREATE TRIGGER provider_returned_descriptions_no_delete
BEFORE DELETE ON provider_returned_descriptions
BEGIN
  SELECT RAISE(ABORT, 'provider returned descriptions are immutable');
END;

CREATE TRIGGER provider_returned_descriptions_no_update
BEFORE UPDATE ON provider_returned_descriptions
BEGIN
  SELECT RAISE(ABORT, 'provider returned descriptions are immutable');
END;

CREATE TRIGGER term_directory_placement_after_term_insert
AFTER INSERT ON terms
BEGIN
  INSERT OR IGNORE INTO term_directory_placements(
    term_id, domain_facet_value_id, item_type_facet_value_id,
    created_at, updated_at, primary_category_id
  ) VALUES (
    NEW.id, NULL, NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL
  );
END;
