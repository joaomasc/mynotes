-- MyNotes — initial schema
--
-- Conventions
--   * IDs are client- or server-generated UUIDs (v7 preferred) stored as TEXT.
--   * Timestamps are ISO-8601 UTC strings ("2026-01-31T12:00:00.000Z"), which
--     sort lexicographically. Calendar dates are "YYYY-MM-DD".
--   * `version` starts at 1 and is incremented on every update; writes carry
--     the version they were based on (optimistic concurrency).
--   * Topics, notes and documents use soft delete (`deleted_at`) and go to the
--     trash. `delete_batch` groups rows deleted together so they can be
--     restored together. Everything else is hard-deleted.
--   * `search_text` holds accent-free lowercase text computed by the API.
--     Search uses instr() (D1 limits LIKE patterns to 50 bytes).
--   * Polymorphic references (relations, favorites, activity) are cleaned up
--     by triggers when the referenced row is hard-deleted.

-- ------------------------------------------------------------------ auth --

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  display_name        TEXT,
  -- Client-side KDF parameters (JSON: alg, salt, memoryKiB, iterations, ...)
  kdf_params          TEXT NOT NULL,
  -- PBKDF2-SHA256(clientKey, verifier_salt, verifier_iterations), base64
  verifier_hash       TEXT NOT NULL,
  verifier_salt       TEXT NOT NULL,
  verifier_iterations INTEGER NOT NULL,
  password_changed_at TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Device-bound ECDSA P-256 public key (JWK JSON) used to authorize refreshes
  public_key    TEXT NOT NULL,
  device_label  TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  -- Absolute expiry; the idle timeout is enforced from last_used_at
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id, revoked_at);

CREATE TABLE access_tokens (
  -- SHA-256 of the high-entropy opaque token (the token itself is never stored)
  token_hash  TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_access_tokens_session ON access_tokens(session_id);
CREATE INDEX idx_access_tokens_expiry ON access_tokens(expires_at);

-- Consumed refresh challenges (single use)
CREATE TABLE auth_nonces (
  nonce_hash  TEXT PRIMARY KEY,
  expires_at  TEXT NOT NULL
);

CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- "ip:<hash>" or "user:<username>"
  bucket      TEXT NOT NULL,
  success     INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_bucket ON login_attempts(bucket, created_at);

-- Responses of mutating requests replayed with the same Idempotency-Key
CREATE TABLE idempotency_keys (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status        INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

-- --------------------------------------------------------------- content --

CREATE TABLE topics (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES topics(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  color         TEXT,
  sort_key      TEXT NOT NULL,
  search_text   TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  delete_batch  TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_topics_tree ON topics(user_id, parent_id, sort_key);
CREATE INDEX idx_topics_deleted ON topics(user_id, deleted_at);

CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id      TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT '',
  -- Tiptap / ProseMirror JSON document
  content       TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '',
  word_count    INTEGER NOT NULL DEFAULT 0,
  -- Plain text of the content (NFC), used for search snippets
  body_text     TEXT NOT NULL DEFAULT '',
  -- normalizeAligned(title || ' ' || body_text): same length in characters
  -- as the original, so match offsets map back to body_text
  search_text   TEXT NOT NULL DEFAULT '',
  sort_key      TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  delete_batch  TEXT
);
CREATE INDEX idx_notes_topic ON notes(user_id, topic_id, sort_key);
CREATE INDEX idx_notes_updated ON notes(user_id, updated_at DESC);
CREATE INDEX idx_notes_deleted ON notes(user_id, deleted_at);

CREATE TABLE note_revisions (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_note_revisions_note ON note_revisions(note_id, created_at DESC);

-- Internal links found in note content (derived; rebuilt on every save)
CREATE TABLE note_links (
  note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL CHECK (target_type IN ('note','topic','document','reading','concept')),
  target_id    TEXT NOT NULL,
  PRIMARY KEY (note_id, target_type, target_id)
);
CREATE INDEX idx_note_links_target ON note_links(target_type, target_id);

CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id       TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  -- Random R2 object key; never derived from user input
  storage_key    TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  search_text    TEXT NOT NULL DEFAULT '',
  uploaded_at    TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  delete_batch   TEXT
);
CREATE INDEX idx_documents_topic ON documents(user_id, topic_id, created_at DESC);
CREATE INDEX idx_documents_deleted ON documents(user_id, deleted_at);

CREATE TABLE concepts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  search_text  TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_concepts_topic ON concepts(user_id, topic_id);

CREATE TABLE readings (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          TEXT REFERENCES topics(id) ON DELETE SET NULL,
  document_id       TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  author            TEXT NOT NULL DEFAULT '',
  material_type     TEXT NOT NULL DEFAULT 'book'
                    CHECK (material_type IN ('book','article','paper','chapter','video','course','other')),
  status            TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','completed')),
  total_pages       INTEGER,
  current_page      INTEGER,
  progress_percent  REAL,
  started_on        TEXT,
  completed_on      TEXT,
  due_on            TEXT,
  priority          INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  notes             TEXT NOT NULL DEFAULT '',
  search_text       TEXT NOT NULL DEFAULT '',
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_readings_status ON readings(user_id, status, updated_at DESC);
CREATE INDEX idx_readings_topic ON readings(user_id, topic_id);
CREATE INDEX idx_readings_due ON readings(user_id, due_on);

CREATE TABLE reading_plans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  goal         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  start_on     TEXT,
  target_on    TEXT,
  search_text  TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_plans_status ON reading_plans(user_id, status, updated_at DESC);

CREATE TABLE reading_plan_items (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES reading_plans(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  reading_id    TEXT REFERENCES readings(id) ON DELETE SET NULL,
  due_on        TEXT,
  completed_at  TEXT,
  sort_key      TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_plan_items_plan ON reading_plan_items(plan_id, sort_key);
CREATE INDEX idx_plan_items_due ON reading_plan_items(due_on, completed_at);

CREATE TABLE study_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          TEXT REFERENCES topics(id) ON DELETE SET NULL,
  started_at        TEXT NOT NULL,
  duration_seconds  INTEGER NOT NULL CHECK (duration_seconds > 0),
  objective         TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  progress_rating   INTEGER CHECK (progress_rating BETWEEN 1 AND 5),
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','timer')),
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_study_sessions_started ON study_sessions(user_id, started_at DESC);
CREATE INDEX idx_study_sessions_topic ON study_sessions(user_id, topic_id);

CREATE TABLE study_session_notes (
  session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, note_id)
);
CREATE INDEX idx_ssn_note ON study_session_notes(note_id);

CREATE TABLE study_session_documents (
  session_id   TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, document_id)
);
CREATE INDEX idx_ssd_document ON study_session_documents(document_id);

-- Typed relations between knowledge entities (generalizes topic_relations)
CREATE TABLE relations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL CHECK (source_type IN ('topic','note','document','reading','concept')),
  source_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('topic','note','document','reading','concept')),
  target_id    TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'related'
               CHECK (kind IN ('related','references','depends_on','part_of','supports','contrasts','example_of')),
  label        TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (NOT (source_type = target_type AND source_id = target_id)),
  UNIQUE (user_id, source_type, source_id, target_type, target_id, kind)
);
CREATE INDEX idx_relations_source ON relations(user_id, source_type, source_id);
CREATE INDEX idx_relations_target ON relations(user_id, target_type, target_id);

CREATE TABLE mind_maps (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  -- JSON: { nodes, edges, viewport }
  data         TEXT NOT NULL,
  node_count   INTEGER NOT NULL DEFAULT 0,
  search_text  TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_mind_maps_updated ON mind_maps(user_id, updated_at DESC);

CREATE TABLE favorites (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('topic','note','document','reading','plan','mindmap')),
  entity_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, entity_type, entity_id)
);

CREATE TABLE activity_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  -- Title snapshot, so history stays readable after renames/deletions
  title        TEXT NOT NULL DEFAULT '',
  occurred_at  TEXT NOT NULL
);
CREATE INDEX idx_activity_user_time ON activity_events(user_id, occurred_at DESC);
CREATE INDEX idx_activity_entity ON activity_events(entity_type, entity_id);

CREATE TABLE settings (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Staged backup imports (validated chunks, applied atomically on commit)
CREATE TABLE import_jobs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('merge','replace')),
  status       TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging','committed','failed')),
  manifest     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Inserting ok = 0 violates the CHECK and rolls an import batch back
CREATE TABLE import_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE import_chunks (
  job_id      TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  table_name  TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- -------------------------------------------------- referential cleanup --
-- Polymorphic references cannot use foreign keys, so hard deletes clean
-- them up here. Soft-deleted rows keep their references (restorable).

CREATE TRIGGER trg_topics_cleanup AFTER DELETE ON topics BEGIN
  DELETE FROM relations WHERE (source_type = 'topic' AND source_id = OLD.id)
                           OR (target_type = 'topic' AND target_id = OLD.id);
  DELETE FROM favorites WHERE entity_type = 'topic' AND entity_id = OLD.id;
  DELETE FROM note_links WHERE target_type = 'topic' AND target_id = OLD.id;
END;

CREATE TRIGGER trg_notes_cleanup AFTER DELETE ON notes BEGIN
  DELETE FROM relations WHERE (source_type = 'note' AND source_id = OLD.id)
                           OR (target_type = 'note' AND target_id = OLD.id);
  DELETE FROM favorites WHERE entity_type = 'note' AND entity_id = OLD.id;
  DELETE FROM note_links WHERE target_type = 'note' AND target_id = OLD.id;
END;

CREATE TRIGGER trg_documents_cleanup AFTER DELETE ON documents BEGIN
  DELETE FROM relations WHERE (source_type = 'document' AND source_id = OLD.id)
                           OR (target_type = 'document' AND target_id = OLD.id);
  DELETE FROM favorites WHERE entity_type = 'document' AND entity_id = OLD.id;
  DELETE FROM note_links WHERE target_type = 'document' AND target_id = OLD.id;
END;

CREATE TRIGGER trg_readings_cleanup AFTER DELETE ON readings BEGIN
  DELETE FROM relations WHERE (source_type = 'reading' AND source_id = OLD.id)
                           OR (target_type = 'reading' AND target_id = OLD.id);
  DELETE FROM favorites WHERE entity_type = 'reading' AND entity_id = OLD.id;
  DELETE FROM note_links WHERE target_type = 'reading' AND target_id = OLD.id;
END;

CREATE TRIGGER trg_concepts_cleanup AFTER DELETE ON concepts BEGIN
  DELETE FROM relations WHERE (source_type = 'concept' AND source_id = OLD.id)
                           OR (target_type = 'concept' AND target_id = OLD.id);
  DELETE FROM note_links WHERE target_type = 'concept' AND target_id = OLD.id;
END;

CREATE TRIGGER trg_plans_cleanup AFTER DELETE ON reading_plans BEGIN
  DELETE FROM favorites WHERE entity_type = 'plan' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_mind_maps_cleanup AFTER DELETE ON mind_maps BEGIN
  DELETE FROM favorites WHERE entity_type = 'mindmap' AND entity_id = OLD.id;
END;
