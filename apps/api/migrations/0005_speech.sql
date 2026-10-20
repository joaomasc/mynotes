-- Speaking practice (docs/oratoria-tecnico.md): one row per recorded talk.
-- The browser measures the audio; the row keeps the transcript, the word
-- timings, a reduced loudness/pitch timeline (charts), the metrics, the
-- measured criteria and, once requested, the model's evaluation.
CREATE TABLE speech_attempts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode                TEXT NOT NULL CHECK (mode IN ('free','explain')),
  speech_type         TEXT NOT NULL CHECK (speech_type IN ('explain','persuasive','impromptu','qa')),
  topic_id            TEXT REFERENCES topics(id) ON DELETE SET NULL,
  theme               TEXT NOT NULL DEFAULT '',
  started_at          TEXT NOT NULL,
  -- YYYY-MM-DD in the user's time zone (streaks count local days)
  local_day           TEXT NOT NULL,
  duration_seconds    REAL NOT NULL DEFAULT 0,
  transcript          TEXT NOT NULL DEFAULT '',
  words_json          TEXT NOT NULL DEFAULT '[]',
  segments_json       TEXT NOT NULL DEFAULT '[]',
  timeline_json       TEXT NOT NULL,
  metrics_json        TEXT NOT NULL,
  measured_json       TEXT NOT NULL,
  evaluation_json     TEXT,
  score               INTEGER CHECK (score BETWEEN 0 AND 100),
  rubric_version      INTEGER NOT NULL,
  -- Copied from the metrics for lists and charts without parsing the JSON
  wpm                 REAL NOT NULL DEFAULT 0,
  fillers_per_minute  REAL NOT NULL DEFAULT 0,
  pvq                 REAL,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_speech_attempts_started ON speech_attempts(user_id, started_at DESC);
CREATE INDEX idx_speech_attempts_topic ON speech_attempts(user_id, topic_id);
