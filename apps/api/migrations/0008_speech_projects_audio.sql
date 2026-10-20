-- Speaking path, stage 4 (docs/oratoria-tecnico.md): your own speeches,
-- kept recordings, the full evaluation and the daily reminder. Additive only.

CREATE TABLE speech_projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('presentation','political','idea')),
  title       TEXT NOT NULL,
  topic_id    TEXT REFERENCES topics(id) ON DELETE SET NULL,
  -- the note that keeps the script
  note_id     TEXT REFERENCES notes(id) ON DELETE SET NULL,
  step        INTEGER NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 11),
  data_json   TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_speech_projects_user ON speech_projects(user_id, updated_at DESC);

-- A rehearsal of a project.
ALTER TABLE speech_attempts ADD COLUMN project_id TEXT REFERENCES speech_projects(id) ON DELETE SET NULL;
-- The kept recording in R2 (8 kHz mono WAV); not in the backup.
ALTER TABLE speech_attempts ADD COLUMN audio_key TEXT;
-- A model listening to the recording (presence, the voice itself).
ALTER TABLE speech_attempts ADD COLUMN full_evaluation_json TEXT;

-- Web Push subscriptions of the user's browsers (device data: not in the backup).
CREATE TABLE speech_push_subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- local day of the last reminder sent to it
  last_sent_on  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_speech_push_user ON speech_push_subscriptions(user_id);
