-- Review ("Revisar", docs/revisar.md): cards and questions scheduled with
-- FSRS, the answers given, the sessions, free recall and the AI proposals
-- waiting for approval.
--
-- 1. study_sessions accepts source = 'review' (a review session also counts
--    in Estudo). SQLite cannot change a CHECK, so the table is rebuilt. The
--    two tables that reference it cascade on delete, so their rows are kept
--    aside and put back; every column, index and row stays the same.
-- 2. New tables (additive):
--      review_cards      one item: kind, text, source note and passage, and the
--                        FSRS state (phase, due, stability, difficulty...)
--      review_sessions   one session: mode, the topics selected, totals
--      review_logs       every answer: rating, confidence, time, the text
--                        answered and the AI correction (needed to tune FSRS)
--      review_recalls    "write everything you remember" about a topic, with
--                        the comparison against the notes
--      review_proposals  questions written by the AI from the notes, waiting
--                        for the user's approval (a cache: not in the backup)
-- 3. Web Push: the review reminder is sent at most once a day per browser,
--    apart from the speaking reminder.
--
-- Rollback (manual, after exporting a backup): drop the review_* tables and
-- the new column; study_sessions can stay as it is.

PRAGMA defer_foreign_keys = true;

CREATE TABLE study_sessions_new (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id          TEXT REFERENCES topics(id) ON DELETE SET NULL,
  started_at        TEXT NOT NULL,
  duration_seconds  INTEGER NOT NULL CHECK (duration_seconds > 0),
  objective         TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  progress_rating   INTEGER CHECK (progress_rating BETWEEN 1 AND 5),
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','timer','review')),
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
INSERT INTO study_sessions_new (id, user_id, topic_id, started_at, duration_seconds, objective, notes, progress_rating, source, version, created_at, updated_at)
  SELECT id, user_id, topic_id, started_at, duration_seconds, objective, notes, progress_rating, source, version, created_at, updated_at FROM study_sessions;

CREATE TABLE keep_study_session_notes AS SELECT session_id, note_id FROM study_session_notes;
CREATE TABLE keep_study_session_documents AS SELECT session_id, document_id FROM study_session_documents;

DROP TABLE study_sessions;
ALTER TABLE study_sessions_new RENAME TO study_sessions;
CREATE INDEX idx_study_sessions_started ON study_sessions(user_id, started_at DESC);
CREATE INDEX idx_study_sessions_topic ON study_sessions(user_id, topic_id);

INSERT OR IGNORE INTO study_session_notes (session_id, note_id) SELECT session_id, note_id FROM keep_study_session_notes;
INSERT OR IGNORE INTO study_session_documents (session_id, document_id) SELECT session_id, document_id FROM keep_study_session_documents;
DROP TABLE keep_study_session_notes;
DROP TABLE keep_study_session_documents;

-- ------------------------------------------------------------- review --

CREATE TABLE review_cards (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Own topic: used when the card has no note (with a note, the note's topic
  -- — or its book's, for annotations — is read at query time).
  topic_id        TEXT REFERENCES topics(id) ON DELETE SET NULL,
  note_id         TEXT REFERENCES notes(id) ON DELETE SET NULL,
  -- Cards created together (cloze numbers, a reverse card): one per session.
  group_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('basic','cloze','typed','open','essay')),
  origin          TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','ai','relation')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  front           TEXT NOT NULL,
  back            TEXT NOT NULL DEFAULT '',
  cloze_index     INTEGER CHECK (cloze_index IS NULL OR cloze_index BETWEEN 1 AND 99),
  -- JSON array of strings: what a good answer must have (open questions, essays).
  key_points      TEXT NOT NULL DEFAULT '[]',
  -- The passage of the note the card comes from, and a short normalized piece
  -- of it (as in notes.search_text) to tell whether it is still there.
  source_quote    TEXT NOT NULL DEFAULT '',
  source_probe    TEXT NOT NULL DEFAULT '',
  -- FSRS: phase 0 new, 1 learning, 2 review, 3 relearning.
  phase           INTEGER NOT NULL DEFAULT 0 CHECK (phase BETWEEN 0 AND 3),
  due             TEXT NOT NULL,
  stability       REAL NOT NULL DEFAULT 0,
  difficulty      REAL NOT NULL DEFAULT 0,
  scheduled_days  INTEGER NOT NULL DEFAULT 0,
  learning_steps  INTEGER NOT NULL DEFAULT 0,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  last_review     TEXT,
  search_text     TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_review_cards_due ON review_cards(user_id, status, due);
CREATE INDEX idx_review_cards_note ON review_cards(note_id) WHERE note_id IS NOT NULL;
CREATE INDEX idx_review_cards_topic ON review_cards(user_id, topic_id);

CREATE TABLE review_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode              TEXT NOT NULL CHECK (mode IN ('due','cards','questions','practice','recall')),
  -- JSON array of the topic ids selected (each with its descendants).
  topic_ids         TEXT NOT NULL DEFAULT '[]',
  local_day         TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  seconds           INTEGER NOT NULL DEFAULT 0,
  reviewed          INTEGER NOT NULL DEFAULT 0,
  correct           INTEGER NOT NULL DEFAULT 0,
  study_session_id  TEXT REFERENCES study_sessions(id) ON DELETE SET NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_review_sessions_user ON review_sessions(user_id, started_at DESC);

CREATE TABLE review_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id         TEXT NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  confidence      INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 3),
  phase_before    INTEGER NOT NULL CHECK (phase_before BETWEEN 0 AND 3),
  elapsed_days    REAL NOT NULL DEFAULT 0,
  scheduled_days  INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  answer          TEXT NOT NULL DEFAULT '',
  -- The question as asked, when the AI rephrased it.
  prompt          TEXT NOT NULL DEFAULT '',
  score           INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  evaluation_json TEXT,
  disputed        INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),
  reviewed_at     TEXT NOT NULL,
  -- YYYY-MM-DD in the user's time zone (streaks and new items per day)
  local_day       TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_review_logs_card ON review_logs(card_id, reviewed_at);
CREATE INDEX idx_review_logs_day ON review_logs(user_id, local_day);
CREATE INDEX idx_review_logs_session ON review_logs(session_id) WHERE session_id IS NOT NULL;

CREATE TABLE review_recalls (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id         TEXT REFERENCES topics(id) ON DELETE SET NULL,
  session_id       TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
  text             TEXT NOT NULL,
  evaluation_json  TEXT,
  coverage         INTEGER CHECK (coverage IS NULL OR coverage BETWEEN 0 AND 100),
  local_day        TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_review_recalls_topic ON review_recalls(user_id, topic_id, created_at DESC);

CREATE TABLE review_proposals (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id      TEXT NOT NULL,
  topic_id      TEXT REFERENCES topics(id) ON DELETE SET NULL,
  note_id       TEXT REFERENCES notes(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('basic','cloze','typed','open','essay')),
  origin        TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('manual','ai','relation')),
  front         TEXT NOT NULL,
  back          TEXT NOT NULL DEFAULT '',
  key_points    TEXT NOT NULL DEFAULT '[]',
  source_quote  TEXT NOT NULL DEFAULT '',
  source_probe  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_review_proposals_user ON review_proposals(user_id, created_at DESC);

ALTER TABLE speech_push_subscriptions ADD COLUMN review_last_sent_on TEXT;
